import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── URL parsing ───────────────────────────────────────────────
function extractPlaceId(url: string): string | null {
  const patterns = [
    /place\.naver\.com\/(?:place\/|restaurant\/|cafe\/|beauty\/)?(\d+)/,
    /map\.naver\.com\/.*?\/place\/(\d+)/,
    /entry\/place\/(\d+)/,
    /pcmap\.place\.naver\.com\/place\/(\d+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Follow short URL redirect ────────────────────────────────
// naver.me uses HTTP 302 — must use GET (HEAD may not forward redirect properly)
async function resolveUrl(url: string): Promise<string> {
  const isShort = /naver\.me\/|me\.naver\.com\//.test(url);
  if (!isShort) return url;
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });
    // res.url is the final URL after all redirects
    return res.url && res.url !== url ? res.url : url;
  } catch {
    return url;
  }
}

// ─── Scrape Naver Place reviews ───────────────────────────────
interface NaverReview {
  id: string;
  rating: number;
  body: string;
  author: string;
  authorReviewCount?: number;
  created: string;
  tags?: string[];
  reply?: string;
}

interface PlaceInfo {
  name: string;
  category: string;
  totalReviewCount: number;
  ratingAvg: number;
}

async function scrapeNaverPlace(placeId: string): Promise<{ info: PlaceInfo; reviews: NaverReview[] }> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Referer': 'https://m.place.naver.com/',
    'Origin': 'https://m.place.naver.com',
  };

  // Strategy 1: Naver Place GraphQL API
  const graphqlBody = {
    operationName: 'getVisitorReviews',
    variables: {
      input: {
        businessId: placeId,
        businessType: 'place',
        item: '0',
        page: 1,
        size: 50,
        sort: 'recent',
      },
    },
    query: `query getVisitorReviews($input: VisitorReviewsInput) {
      visitorReviews(input: $input) {
        items {
          id
          rating
          body
          created
          tags
          author { id nickname imageUrl review { totalCount } }
          reply { body }
        }
        total
        hasMore
      }
    }`,
  };

  try {
    const graphqlRes = await fetch('https://api.place.naver.com/graphql', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(graphqlBody),
      signal: AbortSignal.timeout(8000),
    });

    if (graphqlRes.ok) {
      const data = await graphqlRes.json();
      const items = data?.data?.visitorReviews?.items;
      const total = data?.data?.visitorReviews?.total;

      if (items && items.length > 0) {
        const reviews: NaverReview[] = items.map((r: Record<string, unknown>) => {
          const author = r.author as Record<string, unknown> | undefined;
          const review = author?.review as Record<string, unknown> | undefined;
          const reply = r.reply as Record<string, unknown> | undefined;
          return {
            id: String(r.id ?? ''),
            rating: Number(r.rating ?? 0),
            body: String(r.body ?? ''),
            author: String(author?.nickname ?? '익명'),
            authorReviewCount: Number(review?.totalCount ?? 0),
            created: String(r.created ?? ''),
            tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
            reply: reply ? String(reply.body ?? '') : undefined,
          };
        });

        return {
          info: {
            name: `플레이스 ID ${placeId}`,
            category: '업체',
            totalReviewCount: Number(total ?? reviews.length),
            ratingAvg: reviews.reduce((s, r) => s + r.rating, 0) / (reviews.length || 1),
          },
          reviews,
        };
      }
    }
  } catch {
    // fall through to next strategy
  }

  // Strategy 2: Fetch mobile page and parse embedded __PLACE_DATA__
  try {
    const pageRes = await fetch(`https://m.place.naver.com/place/${placeId}/review/visitor`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (pageRes.ok) {
      const html = await pageRes.text();

      // Extract JSON from window.__PLACE_DATA__ or __NEXT_DATA__
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextDataMatch) {
        const nextData = JSON.parse(nextDataMatch[1]);
        const placeData = nextData?.props?.pageProps;

        if (placeData?.reviews || placeData?.visitorReviews) {
          const rawReviews = placeData.reviews || placeData.visitorReviews || [];
          const reviews: NaverReview[] = rawReviews.map((r: Record<string, unknown>, i: number) => ({
            id: String(r.id ?? i),
            rating: Number(r.rating ?? r.score ?? 0),
            body: String(r.body ?? r.content ?? r.text ?? ''),
            author: String(r.authorName ?? r.nickname ?? '익명'),
            authorReviewCount: Number(r.authorReviewCount ?? 0),
            created: String(r.created ?? r.date ?? ''),
            tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
          }));

          return {
            info: {
              name: String(placeData.name ?? placeData.title ?? `ID ${placeId}`),
              category: String(placeData.category ?? '업체'),
              totalReviewCount: Number(placeData.totalReviewCount ?? reviews.length),
              ratingAvg: reviews.reduce((s, r) => s + r.rating, 0) / (reviews.length || 1),
            },
            reviews,
          };
        }
      }
    }
  } catch {
    // fall through
  }

  throw new Error('리뷰를 불러올 수 없습니다. 네이버 플레이스 링크를 다시 확인해주세요.');
}

// ─── Claude analysis ──────────────────────────────────────────
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
  "main_concern": "가장 우려되는 점 한 문장",
  "suspicious_patterns": ["의심 패턴1", "의심 패턴2"],
  "positive_signals": ["신뢰 신호1", "신뢰 신호2"],
  "praised": ["자주 언급된 칭찬 포인트1", "칭찬 포인트2", "칭찬 포인트3"],
  "criticized": ["자주 언급된 불만 포인트1", "불만 포인트2"]
}`;

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();
    if (!url?.trim()) {
      return NextResponse.json({ error: '네이버 플레이스 링크를 입력해주세요.' }, { status: 400 });
    }

    const resolved = await resolveUrl(url.trim());
    const placeId = extractPlaceId(resolved);

    if (!placeId) {
      return NextResponse.json(
        { error: '올바른 네이버 플레이스 링크를 입력해주세요.\n(예: https://map.naver.com/v5/entry/place/12345678)' },
        { status: 400 }
      );
    }

    const { info, reviews } = await scrapeNaverPlace(placeId);

    if (reviews.length === 0) {
      return NextResponse.json({ error: '리뷰가 없거나 불러올 수 없는 플레이스입니다.' }, { status: 400 });
    }

    // Build review digest for Claude
    const reviewText = reviews
      .slice(0, 40)
      .map((r, i) =>
        `[${i + 1}] ★${r.rating} | 작성자: ${r.author}(리뷰${r.authorReviewCount ?? '?'}개) | ${r.created}\n${r.body}${r.tags?.length ? `\n태그: ${r.tags.join(', ')}` : ''}${r.reply ? `\n→ 사장님: ${r.reply}` : ''}`
      )
      .join('\n\n');

    const userPrompt = `업체명: ${info.name}
카테고리: ${info.category}
총 리뷰 수: ${info.totalReviewCount}개
평균 평점: ${info.ratingAvg.toFixed(1)}점

--- 최근 리뷰 ${reviews.length}개 ---
${reviewText}

위 리뷰들을 분석해서 신뢰도를 평가해주세요.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = (response.content[0] as { type: string; text: string }).text;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('분석 결과 파싱 실패');

    const result = JSON.parse(match[0]);
    return NextResponse.json({
      ...result,
      place: { name: info.name, category: info.category, totalReviewCount: info.totalReviewCount, ratingAvg: info.ratingAvg },
      reviewCount: reviews.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '분석 중 오류가 발생했습니다.';
    console.error('[analyze]', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
