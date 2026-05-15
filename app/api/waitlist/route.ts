import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { name, email, phone, consent } = await request.json();

    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: '이름과 이메일을 입력해주세요.' }, { status: 400 });
    }
    if (!consent) {
      return NextResponse.json({ error: '개인정보 수집·이용에 동의해주세요.' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: '올바른 이메일 주소를 입력해주세요.' }, { status: 400 });
    }

    console.log('[WAITLIST]', JSON.stringify({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone?.trim() || null,
      consentAt: new Date().toISOString(),
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
    }));

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: '오류가 발생했습니다. 다시 시도해주세요.' }, { status: 500 });
  }
}
