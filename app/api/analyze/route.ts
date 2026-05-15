import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── URL parsing ───────────────────────────────────────────────
function extractPlaceId(url: string): string | null {
  const patterns = [
    // new /p/ format: map.naver.com/p/smart-around/place/123
    /map\.naver\.com\/p\/[^?#]*\/place\/(\d+)/,
    // classic v5 format: map.naver.com/v5/entry/place/123
    /map\.naver\.com\/v5\/entry\/place\/(\d+)/,
    // place.naver.com variants
    /place\.naver\.com\/(?:place\/|restaurant\/|cafe\/|beauty\/|hospital\/|hairshop\/)?(\d+)/,
    // pcmap
    /pcmap\.place\.naver\.com\/place\/(\d+)/,
    // generic entry fallback
    /entry\/place\/(\d+)/,
    // businessId query param (some share URLs)
    /[?&]businessId=(\d+)/,
    // bare 9-10 digit number at end of path (last resort)
    /\/(\d{9,10})(?:[/?#]|$)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Follow short URL redirect ────────────────────────────────
async function resolveUrl(url: string): Promise<string> {
  const isShort = /naver\.me\/|me\.naver\.com\//.test(url);
  if (!isShort) return url;
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });
    return res.url && res.url !== url ? res.url : url;
  } catch {
    return url;
  }
}

// ─── Review types ──────────────────────────────────────────────
interface NaverReview {
  id: string;
  rating: number;
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

// ─── Deep-scan parsed JSON for reviews ────────────────────────
function looksLikeReview(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const r = obj as Record<string, unknown>;
  const hasText = 'body' in r || 'content' in r || 'text' in r || 'reviewText' in r;
  const hasRating = 'rating' in r || 'score' in r || 'starRating' in r;
  const hasAuthor = 'author' in r || 'nickname' in r || 'authorName' in r || 'writer' in r;
  return hasText && (hasRating || hasAuthor);
}

function parseOneReview(r: Record<string, unknown>, i: number): NaverReview {
  const author = r.author as Record<string, unknown> | string | undefined;
  const authorName =
    typeof author === 'string' ? author
    : typeof author === 'object' && author
      ? String((author as Record<string, unknown>).nickname ?? (author as Record<string, unknown>).name ?? '익명')
    : String(r.nickname ?? r.authorName ?? r.writer ?? '익명');

  const authorReviewCount =
    typeof author === 'object' && author
      ? Number((author as Record<string, unknown>).totalReviewCount
          ?? ((author as Record<string, unknown>).review as Record<string, unknown> | undefined)?.totalCount
          ?? 0)
      : 0;

  const reply = r.reply as Record<string, unknown> | string | undefined;
  const replyText = reply
    ? typeof reply === 'string' ? reply
      : String((reply as Record<string, unknown>).body ?? (reply as Record<string, unknown>).content ?? '')
    : undefined;

  return {
    id: String(r.id ?? i),
    rating: Number(r.rating ?? r.score ?? r.starRating ?? 0),
    body: String(r.body ?? r.content ?? r.text ?? r.reviewText ?? ''),
    author: authorName,
    authorReviewCount,
    created: String(r.created ?? r.createDate ?? r.writtenDate ?? r.registDate ?? r.date ?? ''),
    tags: Array.isArray(r.tags) ? r.tags.map(String) : Array.isArray(r.categories) ? r.categories.map(String) : [],
    reply: replyText && replyText.length > 0 ? replyText : undefined,
  };
}

const REVIEW_ARRAY_KEYS = [
  'visitorReviewList', 'visitorReviews', 'reviewList', 'reviews',
  'items', 'list', 'data', 'contents', 'result',
];

function deepFindReviews(obj: unknown, depth = 0): NaverReview[] | null {
  if (depth > 12 || !obj || typeof obj !== 'object') return null;

  if (Array.isArray(obj)) {
    if (obj.length >= 3 && obj.slice(0, 3).every(looksLikeReview)) {
      return (obj as Record<string, unknown>[]).map(parseOneReview);
    }
    for (const item of obj) {
      const found = deepFindReviews(item, depth + 1);
      if (found && found.length >= 3) return found;
    }
    return null;
  }

  const record = obj as Record<string, unknown>;
  // Priority keys first
  for (const key of REVIEW_ARRAY_KEYS) {
    if (record[key]) {
      const found = deepFindReviews(record[key], depth + 1);
      if (found && found.length >= 2) return found;
    }
  }
  // Then all other keys
  for (const [key, val] of Object.entries(record)) {
    if (REVIEW_ARRAY_KEYS.includes(key)) continue;
    const found = deepFindReviews(val, depth + 1);
    if (found && found.length >= 2) return found;
  }
  return null;
}

// ─── Scraping strategies ───────────────────────────────────────
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5',
  'Cache-Control': 'no-cache',
};

// Build review result from found reviews
function buildResult(placeId: string, reviews: NaverReview[], totalHint?: number, nameHint?: string): { info: PlaceInfo; reviews: NaverReview[] } {
  const validReviews = reviews.filter(r => r.body.trim().length > 0);
  const ratingAvg = validReviews.reduce((s, r) => s + r.rating, 0) / (validReviews.length || 1);
  return {
    info: {
      name: nameHint || `플레이스 ${placeId}`,
      category: '업체',
      totalReviewCount: totalHint ?? validReviews.length,
      ratingAvg,
    },
    reviews: validReviews,
  };
}

async function tryGraphQL(placeId: string, endpoint: string): Promise<NaverReview[] | null> {
  const operationNames = ['getVisitorReviews', 'visitorReviews', 'getVisitorReviewList'];
  for (const opName of operationNames) {
    try {
      const body = {
        operationName: opName,
        variables: {
          input: { businessId: placeId, businessType: 'place', item: '0', page: 1, size: 50, sort: 'recent' },
          id: placeId, page: 1, display: 50, isPhotoUsed: false, theme: 'allTypes', reviewLanguageCode: 'ko', includeShortReview: true,
        },
        query: `query ${opName}($input: VisitorReviewsInput, $id: String, $page: Int, $display: Int) {
          visitorReviews(input: $input) { items { id rating body created tags author { id nickname review { totalCount } } reply { body } } total }
        }`,
      };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...BASE_HEADERS,
          'Content-Type': 'application/json',
          'User-Agent': MOBILE_UA,
          'Referer': 'https://m.place.naver.com/',
          'Origin': 'https://m.place.naver.com',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const reviews = deepFindReviews(data);
      if (reviews && reviews.length >= 2) return reviews;
    } catch { /* continue */ }
  }
  return null;
}

async function tryHTMLPage(url: string): Promise<{ reviews: NaverReview[]; name?: string; total?: number } | null> {
  try {
    const res = await fetch(url, {
      headers: { ...BASE_HEADERS, 'User-Agent': MOBILE_UA, 'Accept': 'text/html,*/*', 'Referer': 'https://m.place.naver.com/' },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // 1. __NEXT_DATA__ (Next.js SSR)
    const nextMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const parsed = JSON.parse(nextMatch[1]);
        const reviews = deepFindReviews(parsed);
        if (reviews && reviews.length >= 2) {
          const nameMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
          return { reviews, name: nameMatch?.[1]?.replace(/\s*[-|].*$/, '').trim() };
        }
      } catch { /* continue */ }
    }

    // 2. window.__PLACE_DATA__ / window.__STORE__ etc.
    const scriptMatches = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g);
    for (const sm of scriptMatches) {
      const content = sm[1];
      if (content.length < 100) continue;
      // Find JSON-like blobs assigned to window variables
      const jsonBlobMatch = content.match(/(?:window\.__\w+__|__INITIAL_STATE__|__APP_STATE__)\s*=\s*(\{[\s\S]{200,})/);
      if (jsonBlobMatch) {
        try {
          // trim trailing ;
          const raw = jsonBlobMatch[1].replace(/;\s*$/, '');
          const parsed = JSON.parse(raw);
          const reviews = deepFindReviews(parsed);
          if (reviews && reviews.length >= 2) return { reviews };
        } catch { /* continue */ }
      }
      // Look for inline review JSON array
      const inlineMatch = content.match(/"(?:visitorReviewList|reviewList|reviews)"\s*:\s*(\[[\s\S]{100,}?\])\s*[,}]/);
      if (inlineMatch) {
        try {
          const parsed = JSON.parse(inlineMatch[1]);
          const reviews = deepFindReviews(parsed);
          if (reviews && reviews.length >= 2) return { reviews };
        } catch { /* continue */ }
      }
    }

    // 3. application/json script tag
    const jsonScriptMatch = html.match(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/g);
    if (jsonScriptMatch) {
      for (const block of jsonScriptMatch) {
        const inner = block.replace(/<[^>]+>/g, '');
        try {
          const parsed = JSON.parse(inner);
          const reviews = deepFindReviews(parsed);
          if (reviews && reviews.length >= 2) return { reviews };
        } catch { /* continue */ }
      }
    }
    return null;
  } catch { return null; }
}

async function scrapeNaverPlace(placeId: string): Promise<{ info: PlaceInfo; reviews: NaverReview[] }> {
  // Strategy 1: GraphQL (two endpoints)
  for (const ep of ['https://api.place.naver.com/graphql', 'https://pcmap-api.place.naver.com/place/graphql']) {
    const reviews = await tryGraphQL(placeId, ep);
    if (reviews && reviews.length >= 2) return buildResult(placeId, reviews);
  }

  // Strategy 2: Mobile review page (recent, then default sort)
  for (const path of [
    `https://m.place.naver.com/place/${placeId}/review/visitor?reviewSort=recent`,
    `https://m.place.naver.com/place/${placeId}/review/visitor`,
    `https://m.place.naver.com/place/${placeId}`,
  ]) {
    const found = await tryHTMLPage(path);
    if (found && found.reviews.length >= 2) return buildResult(placeId, found.reviews, found.total, found.name);
  }

  // Strategy 3: Desktop pages
  for (const path of [
    `https://pcmap.place.naver.com/place/${placeId}/review/visitor`,
    `https://place.naver.com/place/${placeId}`,
  ]) {
    try {
      const res = await fetch(path, {
        headers: { ...BASE_HEADERS, 'User-Agent': DESKTOP_UA, 'Accept': 'text/html,*/*' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const html = await res.text();
        const nextMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
        if (nextMatch) {
          try {
            const reviews = deepFindReviews(JSON.parse(nextMatch[1]));
            if (reviews && reviews.length >= 2) return buildResult(placeId, reviews);
          } catch { /* continue */ }
        }
      }
    } catch { /* continue */ }
  }

  throw Object.assign(
    new Error(`리뷰를 자동으로 가져올 수 없습니다. (Place ID: ${placeId})\n네이버의 접근 제한으로 인해 리뷰를 직접 붙여넣기로 분석할 수 있습니다.`),
    { placeId, code: 'SCRAPE_FAILED' }
  );
}

// ─── Claude analysis (shared for URL + text modes) ────────────
const SYSTEM_PROMPT = `당신은 온라인 리뷰의 진위 여부를 분석하는 전문가입니다.

분석 기준:
- 리뷰 내용의 구체성 (장소명, 메뉴명, 경험 세부사항 언급 여부)
- 작성자 패턴 (신규 계정, 리뷰 이력 부족, 동일 날짜 집중 등)
- 언어 패턴 (반복 표현, 지나치게 홍보성인 문구, 어색한 문체)
- 평점 분포 이상 (극단적 5점 집중, 1점 테러 패턴)
- 사장님 댓글 패턴

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
      if (text.length < 50) return NextResponse.json({ error: '리뷰 텍스트가 너무 짧습니다. 더 많은 리뷰를 붙여넣어 주세요.' }, { status: 400 });

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
    if (!url?.trim()) return NextResponse.json({ error: '네이버 플레이스 링크를 입력해주세요.' }, { status: 400 });

    const resolved = await resolveUrl(url.trim());
    const placeId = extractPlaceId(resolved);

    if (!placeId) {
      return NextResponse.json({
        error: '링크에서 플레이스 ID를 찾을 수 없습니다.\n아래 형식의 링크를 사용해주세요:\n• https://map.naver.com/p/.../place/123456\n• https://naver.me/xxxxx',
        code: 'PARSE_FAILED',
      }, { status: 400 });
    }

    let info: PlaceInfo, reviews: NaverReview[];
    try {
      ({ info, reviews } = await scrapeNaverPlace(placeId));
    } catch (e) {
      const err = e as Error & { placeId?: string; code?: string };
      return NextResponse.json({
        error: err.message,
        code: err.code ?? 'SCRAPE_FAILED',
        placeId: err.placeId ?? placeId,
      }, { status: 422 });
    }

    if (reviews.length === 0) {
      return NextResponse.json({ error: '분석할 리뷰가 없습니다.', code: 'NO_REVIEWS', placeId }, { status: 400 });
    }

    const reviewText = reviews.slice(0, 40).map((r, i) =>
      `[${i + 1}] ★${r.rating} | ${r.author}(리뷰${r.authorReviewCount}개) | ${r.created}\n${r.body}${r.tags.length ? `\n태그: ${r.tags.join(', ')}` : ''}${r.reply ? `\n→ 사장님: ${r.reply}` : ''}`
    ).join('\n\n');

    const userPrompt = `업체명: ${info.name}\n카테고리: ${info.category}\n총 리뷰 수: ${info.totalReviewCount}개\n평균 평점: ${info.ratingAvg.toFixed(1)}점\n\n--- 최근 리뷰 ${reviews.length}개 ---\n${reviewText}\n\n위 리뷰들을 분석해서 신뢰도를 평가해주세요.`;
    const result = await runClaudeAnalysis(userPrompt);

    return NextResponse.json({
      ...result,
      place: { name: info.name, category: info.category, totalReviewCount: info.totalReviewCount, ratingAvg: info.ratingAvg },
      reviewCount: reviews.length,
    });
  } catch (e) {
    console.error('[analyze]', e);
    return NextResponse.json({ error: '분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
  }
}
