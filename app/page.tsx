'use client';

import { useState, useEffect } from 'react';

// ─── Types ─────────────────────────────────────────────────────
type Verdict = 'trusted' | 'caution' | 'suspicious';

interface PlaceInfo {
  name: string;
  category: string;
  totalReviewCount: number;
  ratingAvg: number;
}

interface AnalysisResult {
  verdict: Verdict;
  trust_score: number;
  summary: string;
  main_concern: string;
  suspicious_patterns: string[];
  positive_signals: string[];
  praised: string[];
  criticized: string[];
  place: PlaceInfo;
  reviewCount: number;
}

// ─── Verdict config ────────────────────────────────────────────
const VERDICT_CONFIG = {
  trusted: {
    label: '신뢰할 수 있는 리뷰',
    sublabel: 'Trustworthy',
    stamp: '✓',
    stampBg: 'bg-[#00C37D]',
    headerBg: 'bg-[#F0FFF8]',
    scoreBg: 'bg-[#00C37D]',
    tagBg: 'bg-[#F0FFF8]', tagText: 'text-[#00A86B]', tagBorder: 'border-[#B0EEDD]',
  },
  caution: {
    label: '일부 주의 필요',
    sublabel: 'Caution',
    stamp: '!',
    stampBg: 'bg-[#FF8A00]',
    headerBg: 'bg-[#FFFBF0]',
    scoreBg: 'bg-[#FF8A00]',
    tagBg: 'bg-[#FFF8ED]', tagText: 'text-[#FF8A00]', tagBorder: 'border-[#FFE4B0]',
  },
  suspicious: {
    label: '의심 정황 발견',
    sublabel: 'Suspicious',
    stamp: '?',
    stampBg: 'bg-[#FF4651]',
    headerBg: 'bg-[#FFF5F5]',
    scoreBg: 'bg-[#FF4651]',
    tagBg: 'bg-[#FFF0F0]', tagText: 'text-[#FF4651]', tagBorder: 'border-[#FFD0D0]',
  },
};

// ─── Privacy text ──────────────────────────────────────────────
const PRIVACY_TEXT = `■ 개인정보 수집·이용 동의서

리뷰체크(이하 "서비스")은 대기 예약 및 서비스 출시 안내를 위해 아래와 같이 개인정보를 수집·이용합니다.

1. 수집 항목
   - 필수: 이름, 이메일 주소
   - 선택: 휴대폰 번호

2. 수집·이용 목적
   - 서비스 정식 출시 시 사전 안내 및 우선 초대
   - 대기 예약 현황 확인 및 관리
   - 서비스 관련 공지사항 발송

3. 보유·이용 기간
   - 서비스 정식 출시 후 1년, 또는 이용자가 동의를 철회하는 시점까지
   - 동의 철회 요청: reviewcheck@sandburg.co.kr

4. 동의 거부 권리 및 불이익
   - 개인정보 수집·이용에 동의하지 않을 권리가 있습니다.
   - 다만, 동의 거부 시 대기 예약 등록이 제한됩니다.

5. 개인정보의 제3자 제공
   - 수집된 개인정보는 제3자에게 제공되지 않습니다.

본 동의서는 개인정보보호법 제15조에 따라 작성되었습니다.`;

// ─── Waitlist modal ────────────────────────────────────────────
function WaitlistModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, consent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg bg-white rounded-t-2xl overflow-hidden max-h-[92dvh] flex flex-col">
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#DDDDDD]" />
        </div>
        <div className="px-5 pt-2 pb-4 border-b border-[#EEEEEE] flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-[17px] font-black text-[#111111]">대기 예약</h2>
            <p className="text-[11px] text-[#8D8D8D] mt-0.5">출시 알림을 가장 먼저 받아보세요</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-[#F5F5F5] text-[#666] text-lg">×</button>
        </div>

        <div className="overflow-y-auto flex-1">
          {success ? (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
              <div className="w-16 h-16 rounded-full bg-[#00C37D] flex items-center justify-center text-white text-3xl font-black mb-4">✓</div>
              <h3 className="text-[18px] font-black text-[#111111] mb-2">예약 완료!</h3>
              <p className="text-sm text-[#666666] leading-relaxed">
                <span className="font-semibold text-[#111111]">{email}</span>로<br />출시 알림을 보내드릴게요.
              </p>
              <button onClick={onClose} className="mt-8 w-full py-4 rounded-xl bg-[#111111] text-white font-bold text-[15px]">확인</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-[12px] font-bold text-[#444444] mb-1.5">이름 <span className="text-[#FF4651]">*</span></label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="홍길동" required
                    className="w-full border border-[#DDDDDD] rounded-xl px-4 py-3 text-[14px] text-[#111111] placeholder-[#BBBBBB] focus:outline-none focus:border-[#111111] transition-colors" />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-[#444444] mb-1.5">이메일 <span className="text-[#FF4651]">*</span></label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="example@email.com" required
                    className="w-full border border-[#DDDDDD] rounded-xl px-4 py-3 text-[14px] text-[#111111] placeholder-[#BBBBBB] focus:outline-none focus:border-[#111111] transition-colors" />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-[#444444] mb-1.5">휴대폰 번호 <span className="text-[#AAAAAA] font-normal">(선택)</span></label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="010-0000-0000"
                    className="w-full border border-[#DDDDDD] rounded-xl px-4 py-3 text-[14px] text-[#111111] placeholder-[#BBBBBB] focus:outline-none focus:border-[#111111] transition-colors" />
                </div>
              </div>

              <div className="bg-[#F9F9F9] border border-[#EEEEEE] rounded-xl overflow-hidden">
                <button type="button" onClick={() => setPrivacyOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3.5">
                  <span className="text-[12px] font-bold text-[#333333]">개인정보 수집·이용 동의 내용 보기</span>
                  <span className="text-[#8D8D8D] text-base">{privacyOpen ? '−' : '+'}</span>
                </button>
                {privacyOpen && (
                  <div className="px-4 pb-4 border-t border-[#EEEEEE]">
                    <pre className="mt-3 text-[11px] text-[#555555] leading-relaxed whitespace-pre-wrap font-sans">{PRIVACY_TEXT}</pre>
                  </div>
                )}
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <div className="relative mt-0.5">
                  <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="sr-only" />
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${consent ? 'bg-[#111111] border-[#111111]' : 'bg-white border-[#DDDDDD]'}`}>
                    {consent && <span className="text-white text-[11px] font-bold">✓</span>}
                  </div>
                </div>
                <span className="text-[13px] text-[#333333] leading-snug">개인정보 수집·이용에 동의합니다. <span className="text-[#FF4651] font-semibold">(필수)</span></span>
              </label>

              {error && <div className="bg-[#FFF0F0] border border-[#FFD0D0] rounded-xl px-4 py-3 text-sm text-[#CC0000]">{error}</div>}

              <button type="submit" disabled={!consent || !name || !email || loading}
                className={`w-full py-4 rounded-xl font-bold text-[15px] transition-all ${consent && name && email && !loading ? 'bg-[#111111] text-white active:scale-[0.98]' : 'bg-[#DDDDDD] text-[#AAAAAA] cursor-not-allowed'}`}>
                {loading ? (
                  <span className="flex items-center justify-center gap-2.5">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />등록 중...
                  </span>
                ) : '대기 예약 등록'}
              </button>

              <p className="text-center text-[11px] text-[#AAAAAA] pb-2">수집된 정보는 출시 안내 목적으로만 사용되며 제3자에게 제공되지 않습니다.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Result view ───────────────────────────────────────────────
function ResultView({ result, onReset }: { result: AnalysisResult; onReset: () => void }) {
  const cfg = VERDICT_CONFIG[result.verdict];
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <div className="bg-white min-h-screen">
      {/* Verdict hero */}
      <div className={`${cfg.headerBg} px-5 pt-7 pb-6 border-b border-[#EEEEEE]`}>
        <div className="flex items-center gap-4 mb-4">
          <div className={`w-16 h-16 rounded-2xl ${cfg.stampBg} flex items-center justify-center text-3xl font-black text-white shrink-0`}>
            {cfg.stamp}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-[#8D8D8D] uppercase tracking-widest mb-0.5">AI 분석 결과</p>
            <h2 className="text-[20px] font-black text-[#111111] leading-tight">{cfg.label}</h2>
            <p className="text-xs text-[#8D8D8D] mt-0.5 truncate">{result.place.name} · 리뷰 {result.reviewCount}개 분석</p>
          </div>
        </div>

        {/* Trust score bar */}
        <div className="bg-white/80 rounded-xl px-4 py-3 border border-[#EEEEEE]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-[#666666]">신뢰도 점수</span>
            <span className="text-[15px] font-black text-[#111111]">{result.trust_score}<span className="text-[11px] font-normal text-[#8D8D8D]">/100</span></span>
          </div>
          <div className="h-2 bg-[#EEEEEE] rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${cfg.scoreBg} transition-all`} style={{ width: `${result.trust_score}%` }} />
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="px-5 py-3 border-b border-[#EEEEEE] bg-[#FAFAFA]">
        <p className="text-[11px] text-[#8D8D8D] leading-relaxed">본 분석은 AI 참고용이며 법적 효력이 없습니다. 판단의 최종 책임은 이용자에게 있습니다.</p>
      </div>

      {/* Summary */}
      <div className="px-5 py-5 border-b border-[#EEEEEE]">
        <p className="text-[13px] font-bold text-[#888888] mb-2 uppercase tracking-wider">종합 소견</p>
        <p className="text-[14px] text-[#222222] leading-relaxed">{result.summary}</p>
        {result.main_concern && (
          <div className="mt-3 flex items-start gap-2 bg-[#FFF8ED] border border-[#FFE4B0] rounded-xl px-3.5 py-2.5">
            <span className="text-[#FF8A00] shrink-0 mt-0.5">⚠</span>
            <p className="text-[12px] text-[#333333] leading-snug">{result.main_concern}</p>
          </div>
        )}
      </div>

      {/* Suspicious patterns */}
      {result.suspicious_patterns.length > 0 && (
        <div className="px-5 py-5 border-b border-[#EEEEEE]">
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${cfg.tagBg} ${cfg.tagText} ${cfg.tagBorder}`}>의심 정황</span>
            <span className="text-[11px] text-[#8D8D8D]">{result.suspicious_patterns.length}건</span>
          </div>
          <ul className="space-y-2.5">
            {result.suspicious_patterns.map((p, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-[#FF4651] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <span className="text-[13px] text-[#222222] leading-relaxed">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Positive signals */}
      {result.positive_signals.length > 0 && (
        <div className="px-5 py-5 border-b border-[#EEEEEE]">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-[#F0FFF8] text-[#00A86B] border-[#B0EEDD]">신뢰 신호</span>
            <span className="text-[11px] text-[#8D8D8D]">{result.positive_signals.length}건</span>
          </div>
          <ul className="space-y-2.5">
            {result.positive_signals.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-[#00C37D] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">✓</span>
                <span className="text-[13px] text-[#222222] leading-relaxed">{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Praised / Criticized accordion */}
      <div className="border-b border-[#EEEEEE]">
        <button onClick={() => setDetailOpen(v => !v)} className="w-full flex items-center justify-between px-5 py-4">
          <span className="text-[13px] font-bold text-[#111111]">주요 언급 내용</span>
          <span className="text-[#8D8D8D] text-lg">{detailOpen ? '−' : '+'}</span>
        </button>
        {detailOpen && (
          <div className="px-5 pb-5 space-y-4">
            {result.praised.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-[#00A86B] mb-2 uppercase tracking-wider">자주 칭찬받는 점</p>
                <div className="flex flex-wrap gap-2">
                  {result.praised.map((p, i) => (
                    <span key={i} className="text-[12px] bg-[#F0FFF8] text-[#00A86B] border border-[#B0EEDD] px-3 py-1.5 rounded-full">{p}</span>
                  ))}
                </div>
              </div>
            )}
            {result.criticized.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-[#FF4651] mb-2 uppercase tracking-wider">자주 언급되는 불만</p>
                <div className="flex flex-wrap gap-2">
                  {result.criticized.map((c, i) => (
                    <span key={i} className="text-[12px] bg-[#FFF0F0] text-[#FF4651] border border-[#FFD0D0] px-3 py-1.5 rounded-full">{c}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-5">
        <button onClick={onReset} className="w-full py-4 rounded-xl border-2 border-[#111111] text-[#111111] font-bold text-[14px] hover:bg-[#111111] hover:text-white transition-all duration-150">
          다른 플레이스 분석하기
        </button>
      </div>
    </div>
  );
}

// ─── Loading steps ─────────────────────────────────────────────
const LOADING_STEPS = [
  { icon: '🔗', text: '링크 확인 중...' },
  { icon: '📋', text: '리뷰 데이터 수집 중...' },
  { icon: '🔍', text: '패턴 분석 중...' },
  { icon: '🤖', text: 'AI 신뢰도 평가 중...' },
];

function LoadingView() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStep(s => Math.min(s + 1, LOADING_STEPS.length - 1)), 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bg-white min-h-screen flex flex-col items-center justify-center px-8 py-16">
      <div className="w-14 h-14 border-4 border-[#EEEEEE] border-t-[#111111] rounded-full animate-spin mb-8" />
      <div className="space-y-3 w-full max-w-xs">
        {LOADING_STEPS.map((s, i) => (
          <div key={i} className={`flex items-center gap-3 transition-all duration-500 ${i <= step ? 'opacity-100' : 'opacity-25'}`}>
            <span className="text-lg">{s.icon}</span>
            <span className={`text-[13px] ${i === step ? 'font-bold text-[#111111]' : 'text-[#8D8D8D]'}`}>{s.text}</span>
            {i < step && <span className="text-[#00C37D] ml-auto text-sm">✓</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────
export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const handleAnalyze = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '분석 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setResult(null); setError(null); setUrl(''); };

  if (loading) return <LoadingView />;
  if (result) return <ResultView result={result} onReset={reset} />;

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      {waitlistOpen && <WaitlistModal onClose={() => setWaitlistOpen(false)} />}

      {/* Header */}
      <header className="bg-white border-b border-[#EEEEEE] sticky top-0 z-20">
        <div className="max-w-lg mx-auto px-5 h-14 flex items-center justify-between">
          <span className="text-[17px] font-black text-[#111111] tracking-tight">리뷰체크</span>
          <span className="text-[11px] font-bold text-[#FF4651] bg-[#FFF0F0] border border-[#FFD0D0] px-2.5 py-1 rounded-full">AI 참고용</span>
        </div>
      </header>

      <main className="max-w-lg mx-auto">
        {/* Hero */}
        <div className="bg-white px-5 pt-6 pb-5 border-b border-[#EEEEEE]">
          <h1 className="text-[22px] font-black text-[#111111] leading-snug">
            이 리뷰,<br />믿어도 될까요?
          </h1>
          <p className="text-xs text-[#8D8D8D] mt-1.5 leading-relaxed">
            네이버 플레이스 링크를 붙여넣으면<br />AI가 리뷰 신뢰도를 분석해드립니다.
          </p>
          <button
            onClick={() => setWaitlistOpen(true)}
            className="mt-4 w-full flex items-center justify-between bg-[#111111] text-white rounded-xl px-4 py-3.5 hover:bg-[#333333] active:scale-[0.98] transition-all"
          >
            <div className="flex items-center gap-3">
              <span className="text-base">🔔</span>
              <div className="text-left">
                <p className="text-[13px] font-bold leading-tight">정식 출시 알림 받기</p>
                <p className="text-[11px] text-[#AAAAAA] mt-0.5">대기 예약하고 우선 초대 받으세요</p>
              </div>
            </div>
            <span className="text-[#666666] text-lg shrink-0">›</span>
          </button>
        </div>

        <div className="bg-[#FAFAFA] border-b border-[#EEEEEE] px-5 py-2.5">
          <p className="text-[11px] text-[#8D8D8D]">본 서비스는 참고용이며 법적 효력이 있는 판단이 아닙니다.</p>
        </div>

        {/* URL Input */}
        <div className="bg-white mt-2 border-y border-[#EEEEEE] px-5 py-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-5 h-5 rounded-full bg-[#111111] text-white text-[11px] font-bold flex items-center justify-center">1</span>
            <span className="text-[13px] font-bold text-[#111111]">네이버 플레이스 링크 붙여넣기</span>
          </div>
          <div className="relative">
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAnalyze(); }}
              placeholder="https://map.naver.com/v5/entry/place/..."
              className="w-full border-2 border-[#EEEEEE] rounded-xl px-4 py-3.5 text-[13px] text-[#111111] placeholder-[#BBBBBB] focus:outline-none focus:border-[#111111] transition-colors pr-10"
            />
            {url && (
              <button onClick={() => setUrl('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#BBBBBB] hover:text-[#888] text-lg">×</button>
            )}
          </div>
          <p className="text-[11px] text-[#AAAAAA] mt-2 leading-relaxed">
            네이버 지도 앱 → 장소 선택 → 공유 → 링크 복사 후 붙여넣기
          </p>
        </div>

        {/* What we analyze */}
        <div className="bg-white mt-2 border-y border-[#EEEEEE] px-5 py-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-5 h-5 rounded-full bg-[#111111] text-white text-[11px] font-bold flex items-center justify-center">2</span>
            <span className="text-[13px] font-bold text-[#111111]">AI가 분석하는 항목</span>
          </div>
          <div className="space-y-3">
            {[
              { icon: '🔍', title: '패턴 분석', desc: '반복 표현, 홍보성 문구, 어색한 문체' },
              { icon: '👤', title: '작성자 신뢰도', desc: '신규 계정, 리뷰 이력, 집중 작성 여부' },
              { icon: '⭐', title: '평점 분포', desc: '5점 집중도, 극단적 평점 패턴' },
              { icon: '📅', title: '시간 패턴', desc: '단기간 리뷰 급증, 특정 시점 집중' },
              { icon: '💬', title: '내용 구체성', desc: '실제 경험 여부, 메뉴·장소 세부 언급' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-xl shrink-0">{item.icon}</span>
                <div>
                  <p className="text-[13px] font-bold text-[#111111] leading-tight">{item.title}</p>
                  <p className="text-[11px] text-[#8D8D8D] mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mt-3 bg-[#FFF0F0] border border-[#FFD0D0] rounded-xl px-4 py-3 text-sm text-[#CC0000] whitespace-pre-line">
            {error}
          </div>
        )}

        {/* CTA */}
        <div className="px-4 pt-4 pb-8">
          <button
            onClick={handleAnalyze}
            disabled={!url.trim()}
            className={`w-full py-4 rounded-xl font-bold text-[15px] tracking-tight transition-all duration-150 ${
              url.trim()
                ? 'bg-[#111111] text-white active:scale-[0.98] hover:bg-[#333333]'
                : 'bg-[#DDDDDD] text-[#AAAAAA] cursor-not-allowed'
            }`}
          >
            리뷰 신뢰도 분석하기
          </button>
          {!url.trim() && <p className="text-center text-[12px] text-[#AAAAAA] mt-2">링크를 먼저 붙여넣어 주세요</p>}
        </div>
      </main>
    </div>
  );
}
