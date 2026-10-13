// AI 글 티를 줄이는 문체 규칙 (humanize-korean 스킬 규칙표에서 추림). 세 프롬프트가 같이 쓴다.
const STYLE_RULES = `- 번역투 금지: "~에 대해", "~를 통해", "~에 있어", "~와 관련하여", "~에 의해"는 쓰지 말고 조사로 직결할 것 (예: "직무능력에 대해 평가" → "직무능력을 평가", "지도에 의해 향상됨" → "지도로 향상됨").
- "~을 바탕으로", "~을 위해"를 반복하지 말 것. "~에서의", "~으로의" 같은 겹조사는 풀어 쓸 것.
- "~를 가지고 있다"는 "~이 있다"로 쓰고, 이중 피동("~되어진다")은 쓰지 말 것.
- 문두 접속사(또한, 따라서, 즉, 나아가, 아울러)나 "이는", "이 점에서"로 문장을 시작하지 말 것.
- 상투적 마무리(결론적으로, 요약하면, 이를 통해, 시사하는 바가 크다, 주목할 만하다)와 "~인 것이다", "~다는 의미이다" 같은 결말을 쓰지 말 것.
- 과장 어휘(획기적, 압도적, 현저히, 탁월한 등)와 "-적" 추상어 나열(전반적, 체계적, 지속적 등)을 피하고 수치와 관찰 사실로 서술할 것.
- "~할 수 있다", "~로 보인다", "~할 것이다"를 반복하지 말고, 자료로 확인되는 내용은 단정형으로 쓸 것.
- "평가 결과가 ~을 보여준다"처럼 사물을 주어로 세우지 말고 대상자를 주어로 쓸 것.
- 연결어미(-고, -며, -지만, -어서) 바로 뒤에 쉼표를 찍지 말고, 따옴표로 단어를 강조하지 말 것.
- 명사 앞에 긴 꾸밈말을 겹겹이 달지 말고 두 문장으로 나눌 것.
- 아래 자료에 없는 사실·비유·추측을 덧붙이지 말 것.`;

// 프롬프트를 클립보드에 복사한다 — 채팅 AI에 붙여 넣어 쓰도록.
// 복사 직전에 대상자 이름을 "대상자"로 바꾼다 (이름이 바깥으로 나가지 않게). 이름이 비어 있으면 건너뛴다.
async function copyPrompt(prompt, name) {
  const n = (name || '').trim();
  const text = n ? prompt.replaceAll(n, '대상자') : prompt;
  try {
    await navigator.clipboard.writeText(text);
  } catch(e) {
    // 클립보드 권한이 없는 환경(일부 file:// 등) 대비
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('클립보드에 복사할 수 없습니다');
  }
  toast('복사했습니다. 채팅 AI에 붙여 넣고, 나온 글을 아래 칸에 붙여 넣으세요.', 4500);
}

export { copyPrompt, STYLE_RULES };
