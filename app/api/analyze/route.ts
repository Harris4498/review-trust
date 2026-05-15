import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

// Prefer Seoul region; falls back to mobile scraping if GraphQL is geo-blocked
export const preferredRegion = 'icn1';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── URL parsing ───────────────────────────────────────────────
function extractPlaceId(url: string): string | null {
  const patterns = [
    /map\.naver\.com\/p\/[^?#]*\/place\/(\d+)/,
    /map\.naver\.com\/v5\/entry\/place\/(\d+)/,
    /place\.naver\.com\/(?:place\/|restaurant\/|cafe\/|beauty\/|hospital\/|hairshop\/)?(\d+)/,
    /pcmap\.place\.naver\.com\/place\/(\d+)/,
    /entry\/place\/(\d+)/,
    /[?&]businessId=(\d+)/,
    /\/(\d{9,12})(?:[/?#]|$)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Resolve naver.me short URL ────────────────────────────────
async function resolveUrl(url: string): Promise<string> {
  if (!/naver\.me\/|me\.naver\.com\//.test(url)) return url;
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });
    return res.url && res.url !== url ? res.url : url;
  } catch {
    return url;
  }
}

// ─── Types ─────────────────────────────────────────────────────
interface NaverReview {
  id: string;
  rating: number | null;
  body: string;
  author: string;
  authorReviewCount: number;
  created: string;
  tags: string[];
  reply?: string;
}
interface PlaceInfo {
  name: string;
  category: string;
  totalReviewCount: number;
  ratingAvg: number;
}

// ─── Naver Place GraphQL scraper ───────────────────────────────
async function fetchNaverReviews(placeId: string, page = 1, size = 50): Promise<{ items: NaverReview[]; total: number }> {
  const query = `query getVisitorReviews($input: VisitorReviewsInput) {
    visitorReviews(input: $input) {
      items {
        id
        rating
        body
        created
        tags
        author {
          id
          nickname
          review { totalCount }
        }
        reply { body }
      }
      total
      hasMore
    }
  }`;

  const body = JSON.stringify([{
    operationName: 'getVisitorReviews',
    variables: {
      input: {
        businessId: placeId,
        businessType: 'place',
        item: '0',
        page,
        size,
        sort: 'recent',
      },
    },
    query,
  }]);

  const res = await fetch('https://api.place.naver.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': `https://pcmap.place.naver.com/place/${placeId}/review/visitor`,
      'Origin': 'https://pcmap.place.naver.com',
      'Accept': '*/*',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
    },
    body,
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`Naver GraphQL ${res.status}`);

  const data = await res.json();
  const vr = data?.[0]?.data?.visitorReviews;
  if (!vr) throw new Error('GraphQL 리뷰 데이터 없음');

  const items: NaverReview[] = (vr.items ?? []).map((r: Record<string, unknown>) => {
    const author = r.author as Record<string, unknown> | undefined;
    const reply = r.reply as Record<string, unknown> | undefined;
    return {
      id: String(r.id ?? ''),
      rating: r.rating != null ? Number(r.rating) : null,
      body: String(r.body ?? '').trim(),
      author: String(author?.nickname ?? '익명'),
      authorReviewCount: Number((author?.review as Record<string, unknown> | undefined)?.totalCount ?? 0),
      created: String(r.created ?? ''),
      tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
      reply: reply?.body ? String(reply.body) : undefined,
    };
  });

  return { items, total: Number(vr.total ?? items.length) };
}

// ─── Mobile page Apollo State scraper (fallback) ───────────────
// Used when Naver's GraphQL API rejects the request (geo-blocking from non-KR IPs).
// m.place.naver.com embeds window.__APOLLO_STATE__ in the HTML with review data.
async function scrapeNaverMobilePage(placeId: string): Promise<{ info: PlaceInfo; reviews: NaverReview[] }> {
  const res = await fetch(`https://m.place.naver.com/place/${placeId}/review/visitor`, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`모바일 페이지 오류 ${res.status}`);
  const html = await res.text();

  // Extract window.__APOLLO_STATE__ using brace matching
  const markerIdx = html.indexOf('window.__APOLLO_STATE__');
  if (markerIdx === -1) throw new Error('리뷰 데이터를 찾을 수 없습니다 (Apollo State 없음)');

  const jsonStart = html.indexOf('{', markerIdx);
  if (jsonStart === -1) throw new Error('리뷰 데이터 파싱 실패');

  let depth = 0;
  let jsonEnd = jsonStart;
  for (let i = jsonStart; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { jsonEnd = i + 1; break; }
    }
  }

  const state = JSON.parse(html.slice(jsonStart, jsonEnd)) as Record<string, unknown>;

  // Place info
  const placeKey = Object.keys(state).find(k => k.startsWith('PlaceDetailBase:'));
  const placeData = placeKey ? (state[placeKey] as Record<string, unknown>) : {};

  // Reviews
  const reviewItems: NaverReview[] = [];
  for (const [key, val] of Object.entries(state)) {
    if (!key.startsWith('VisitorReview:') || typeof val !== 'object' || val === null) continue;
    const r = val as Record<string, unknown>;
    const body = String(r.body ?? '').trim();
    if (!body) continue;

    let authorNickname = '익명';
    if (typeof r.author === 'object' && r.author !== null && '__ref' in r.author) {
      const authorRef = (r.author as { __ref: string }).__ref;
      const authorData = state[authorRef] as Record<string, unknown> | undefined;
      if (authorData) authorNickname = String(authorData.nickname ?? '익명');
    }

    let replyBody: string | undefined;
    if (typeof r.reply === 'object' && r.reply !== null) {
      const reply = r.reply as Record<string, unknown>;
      if (reply.body) replyBody = String(reply.body);
    }

    reviewItems.push({
      id: String(r.id ?? ''),
      rating: r.rating != null ? Number(r.rating) : null,
      body,
      author: authorNickname,
      authorReviewCount: 0,
      created: String(r.created ?? ''),
      tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
      reply: replyBody,
    });
  }

  if (reviewItems.length === 0) {
    throw Object.assign(new Error('리뷰가 없거나 비공개 플레이스입니다.'), { code: 'NO_REVIEWS', placeId });
  }

  const ratingItems = reviewItems.filter(r => r.rating != null);
  const ratingAvg = ratingItems.length > 0
    ? ratingItems.reduce((s, r) => s + (r.rating ?? 0), 0) / ratingItems.length
    : 0;

  return {
    info: {
      name: String(placeData.name ?? `플레이스 ${placeId}`),
      category: String(placeData.category ?? '업체'),
      totalReviewCount: Number(placeData.visitorReviewsTotal ?? reviewItems.length),
      ratingAvg,
    },
    reviews: reviewItems,
  };
}

// ─── Orchestrate scraping: GraphQL → mobile page fallback ──────
async function scrapeNaverPlace(placeId: string): Promise<{ info: PlaceInfo; reviews: NaverReview[] }> {
  try {
    const { items, total } = await fetchNaverReviews(placeId, 1, 50);

    if (items.length === 0) {
      throw Object.assign(new Error('리뷰가 없거나 비공개 플레이스입니다.'), { code: 'NO_REVIEWS', placeId });
    }

    let allReviews = items;
    if (total > 50 && items.length === 50) {
      try {
        const page2 = await fetchNaverReviews(placeId, 2, 50);
        allReviews = [...items, ...page2.items];
      } catch { /* use page 1 only */ }
    }

    const ratingItems = allReviews.filter(r => r.rating != null);
    const ratingAvg = ratingItems.length > 0
      ? ratingItems.reduce((s, r) => s + (r.rating ?? 0), 0) / ratingItems.length
      : 0;

    return {
      info: {
        name: `플레이스 ${placeId}`,
        category: '업체',
        totalReviewCount: total,
        ratingAvg,
      },
      reviews: allReviews,
    };
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === 'NO_REVIEWS') throw e;
    // GraphQL failed (likely geo-blocked) — try mobile page
    return scrapeNaverMobilePage(placeId);
  }
}

// ─── Claude analysis ───────────────────────────────────────────
const SYSTEM_PROMPT = `당신은 온라인 리뷰의 진위 여부를 분석하는 전문가입니다.

분석 기준:
- 리뷰 내용의 구체성 (장소명, 메뉴명, 경험 세부사항 언급 여부)
- 작성자 패턴 (리뷰 이력 부족, 동일 날짜 집중 등)
- 언어 패턴 (반복 표현, 지나치게 홍보성인 문구, 어색한 문체)
- 평점 분포 이상 (극단적 5점 집중, 1점 테러 패턴)
- 사장님 댓글 패턴 및 태그 조작 가능성

중요:
- "가짜 리뷰"라고 단정 짓지 마세요. "의심 정황" 또는 "주의 필요" 수준으로 표현하세요.
- 반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요.

{
  "verdict": "trusted" | "caution" | "suspicious",
  "trust_score": 0~100,
  "summary": "2~3문장 종합 소견",
  "main_concern": "가장 우려되는 점 한 문장 (없으면 빈 문자열)",
  "suspicious_patterns": ["의심 패턴1", "의심 패턴2"],
  "positive_signals": ["신뢰 신호1", "신뢰 신호2"],
  "praised": ["자주 언급된 칭찬 포인트1", "칭찬 포인트2", "칭찬 포인트3"],
  "criticized": ["자주 언급된 불만 포인트1", "불만 포인트2"]
}`;

async function runClaudeAnalysis(userPrompt: string) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const raw = (response.content[0] as { type: string; text: string }).text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('분석 결과 파싱 실패');
  return JSON.parse(match[0]);
}

// ─── POST handler ──────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Mode A: raw text paste
    if (body.text) {
      const text = String(body.text).trim();
      if (text.length < 50) {
        return NextResponse.json({ error: '리뷰 텍스트가 너무 짧습니다. 더 많은 리뷰를 붙여넣어 주세요.' }, { status: 400 });
      }
      const userPrompt = `아래는 사용자가 직접 복사해서 붙여넣은 네이버 플레이스 리뷰 텍스트입니다.\n\n---\n${text.slice(0, 6000)}\n---\n\n위 내용을 분석해 신뢰도를 평가해주세요.`;
      const result = await runClaudeAnalysis(userPrompt);
      return NextResponse.json({
        ...result,
        place: { name: body.placeName || '직접 입력', category: '업체', totalReviewCount: 0, ratingAvg: 0 },
        reviewCount: 0,
        isTextMode: true,
      });
    }

    // Mode B: URL scraping
    const { url } = body;
    if (!url?.trim()) {
      return NextResponse.json({ error: '네이버 플레이스 링크를 입력해주세요.' }, { status: 400 });
    }

    const resolved = await resolveUrl(url.trim());
    const placeId = extractPlaceId(resolved);

    if (!placeId) {
      return NextResponse.json({
        error: '링크에서 플레이스 ID를 찾을 수 없습니다.\n아래 형식의 링크를 사용해주세요:\n• https://map.naver.com/p/.../place/123456\n• https://naver.me/xxxxx',
        code: 'PARSE_FAILED',
      }, { status: 400 });
    }

    const { info, reviews } = await scrapeNaverPlace(placeId);

    const reviewText = reviews.slice(0, 60).map((r, i) =>
      `[${i + 1}] ${r.rating != null ? `★${r.rating}` : '별점없음'} | ${r.author}(리뷰${r.authorReviewCount}개) | ${r.created}\n${r.body}${r.tags.length ? `\n태그: ${r.tags.join(', ')}` : ''}${r.reply ? `\n→ 사장님: ${r.reply}` : ''}`
    ).join('\n\n');

    const ratingLine = info.ratingAvg > 0 ? `평균 평점: ${info.ratingAvg.toFixed(1)}점` : '(별점 데이터 없음)';
    const userPrompt = `업체명: ${info.name}\n총 리뷰 수: ${info.totalReviewCount}개\n${ratingLine}\n분석 리뷰 수: ${reviews.length}개\n\n--- 최근 리뷰 ---\n${reviewText}\n\n위 리뷰들을 분석해서 신뢰도를 평가해주세요.`;

    const result = await runClaudeAnalysis(userPrompt);

    return NextResponse.json({
      ...result,
      place: {
        name: info.name,
        category: info.category,
        totalReviewCount: info.totalReviewCount,
        ratingAvg: info.ratingAvg,
      },
      reviewCount: reviews.length,
    });
  } catch (e) {
    const err = e as Error & { code?: string; placeId?: string };
    console.error('[analyze]', err.message);
    return NextResponse.json({
      error: err.message || '분석 중 오류가 발생했습니다.',
      code: err.code ?? 'ERROR',
      placeId: err.placeId,
    }, { status: err.code === 'NO_REVIEWS' ? 400 : 500 });
  }
}
