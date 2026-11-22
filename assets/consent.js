/* DARK CODE · remote support consent page (target side) */
import * as cloud from './cloud.js?v=20261122k';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const TASKS = {
  diagnose: ['시스템 진단', '운영체제·드라이버·디스크 상태 점검'],
  cleanup: ['임시/불필요 파일 정리', '임시 폴더·캐시·휴지통 등 사용자 데이터가 아닌 파일만'],
  optimize: ['성능 최적화', '시작 프로그램·백그라운드 프로세스·전원 설정 조정'],
};

const stream = new DCStream.TokenStream($('#bgStream'), { size: 15 });
stream.start();
setInterval(() => { const d = new Date(); $('#clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }, 1000);

const sid = new URLSearchParams(location.search).get('sid') || '';
$('#sid').textContent = sid ? `${sid.slice(0, 4)}-${sid.slice(4, 8)}-${sid.slice(-4)}` : '없음';
let sess = null, tick = null, total = 1, responding = false;

function setCard(cls) { const c = $('#card'); c.classList.remove('alert', 'ok'); if (cls) c.classList.add(cls); }
function timerText(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }

function envInfo() {
  const ua = navigator.userAgentData;
  return {
    platform: ua?.platform || navigator.platform || 'unknown',
    browser: ua?.brands?.filter((b) => !/Not.?A.?Brand/i.test(b.brand)).map((b) => `${b.brand} ${b.version}`).slice(-1)[0] || navigator.userAgent.split(' ').slice(-1)[0],
    cores: navigator.hardwareConcurrency || null,
    memoryGB: navigator.deviceMemory || null,
    screen: `${screen.width}x${screen.height}@${devicePixelRatio || 1}x`,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: navigator.language,
  };
}

function render() {
  const st = $('#state');
  if (!sess) {
    setCard('alert');
    st.innerHTML = `<div class="big bad">SESSION NOT FOUND</div><p class="sub">유효하지 않거나 삭제된 요청 링크입니다. 요청자에게 새 링크를 받아주세요.</p>`;
    return;
  }
  $('#req').textContent = `${sess.requesterName} <${sess.requesterEmail}>`;
  const left = (sess.expiresAt?.toMillis?.() || 0) - Date.now();
  if (sess.status === 'pending' && left <= 0) { cloud.expireRemote(sid).catch(() => {}); sess.status = 'expired'; }
  const s = sess.status;
  if (s === 'pending') {
    setCard('');
    st.innerHTML = `
      <p class="q">귀하의 컴퓨터에 원격 점검 및 시스템 최적화를 위해<br>접근하는 것을 수락하시겠습니까?</p>
      <div class="from">요청자 <b>${esc(sess.requesterName)}</b> · ${esc(sess.requesterEmail)} <span style="color:var(--g1)">✔ 인증된 DARK CODE 계정</span></div>
      ${sess.note ? `<div class="note">&gt; ${esc(sess.note)}</div>` : ''}
      <ul class="tasks">${(sess.tasks || []).filter((t) => TASKS[t]).map((t) => `<li><i>✓</i><div>${TASKS[t][0]}<small>${TASKS[t][1]}</small></div></li>`).join('')}</ul>
      <div class="share"><b style="color:var(--g1)">수락 시 요청자에게 공유되는 정보</b><br>운영체제 · 브라우저 종류 · CPU 코어 수 · 대략적인 메모리 · 화면 해상도 · 시간대 · 언어 (파일·비밀번호·쿠키는 공유되지 않음)</div>
      <div class="warn-box">⚠ 직접 요청하지 않은 지원이라면 <b>거절</b>하세요. 이 페이지는 승인 여부만 전달하며 브라우저는 PC 파일에 접근할 수 없습니다. 실제 원격 작업은 요청자가 안내하는 원격 지원 프로그램에서 귀하가 다시 허용해야 시작되며, 언제든 세션을 종료할 수 있습니다.</div>
      <div class="btns">
        <button class="btn accept" id="btnAccept">수락 (ACCEPT)<small>연결 승인 · 세션 활성화</small></button>
        <button class="btn deny" id="btnDeny">거절 (DENY)<small>세션 폐기 · 차단</small></button>
      </div>`;
    $('#btnAccept').onclick = () => answer('accepted');
    $('#btnDeny').onclick = () => answer('denied');
    return;
  }
  stopTimer(s);
  if (s === 'accepted') {
    setCard('ok');
    const log = (sess.log || []).slice(-40);
    st.innerHTML = `
      <div class="big ok">ACCESS GRANTED</div>
      <p class="sub">연결 승인 완료 · 원격 지원/최적화 세션이 활성화되었습니다.<br>요청자 화면에도 승인 상태가 실시간으로 표시됩니다.</p>
      <div class="log" id="log">${log.length ? log.map((l) => `<div><span style="color:var(--mut2)">${[new Date(l.t).getHours(), new Date(l.t).getMinutes(), new Date(l.t).getSeconds()].map(pad).join(':')}</span> ${esc(l.msg)}</div>`).join('') : '<div>요청자의 안내 메시지를 기다리는 중…</div>'}</div>
      <button class="btn-end" id="btnEnd">세션 종료 (END SESSION)</button>`;
    const lg = $('#log'); lg.scrollTop = lg.scrollHeight;
    $('#btnEnd').onclick = async () => { $('#btnEnd').disabled = true; try { await cloud.endRemote(sid, 'target'); } catch (e) { alert('종료 실패: ' + e.message); $('#btnEnd').disabled = false; } };
    return;
  }
  setCard(s === 'ended' ? '' : 'alert');
  const map = {
    denied: ['ACCESS DENIED', '요청을 거절했습니다. 세션이 폐기되고 차단 상태가 요청자 화면에도 동기화되었습니다.'],
    expired: ['SESSION EXPIRED', '응답 시간이 지나 세션이 자동 폐기되었습니다. 요청자 화면에도 차단 상태로 표시됩니다.'],
    cancelled: ['REQUEST CANCELLED', '요청자가 요청을 취소했습니다.'],
    ended: ['SESSION ENDED', `원격 지원 세션이 종료되었습니다 (${sess.endedBy === 'target' ? '귀하가 종료' : '요청자가 종료'}).`],
  };
  const [t, d] = map[s] || ['UNKNOWN', s];
  st.innerHTML = `<div class="big ${s === 'ended' ? 'mut' : 'bad'}">${t}</div><p class="sub">${d}</p><p class="sub" style="font:11px var(--mono)">이 창은 닫아도 됩니다.</p>`;
}

async function answer(status) {
  if (responding) return; responding = true;
  $$('.btn').forEach((b) => (b.disabled = true));
  try { await cloud.respondRemote(sid, status, status === 'accepted' ? envInfo() : null); }
  catch (e) { responding = false; $$('.btn').forEach((b) => (b.disabled = false)); alert('응답 실패: ' + (e.code === 'permission-denied' ? '이미 처리되었거나 만료된 요청입니다' : e.message)); }
}
const $$ = (s) => [...document.querySelectorAll(s)];

function startTimer() {
  if (tick) return;
  const exp = sess.expiresAt?.toMillis?.() || Date.now();
  const created = sess.createdAt?.toMillis?.() || Date.now();
  total = Math.max(1000, exp - created);
  const step = () => {
    const left = exp - Date.now();
    $('#timer').textContent = timerText(left);
    $('#timer').classList.toggle('low', left < 30000);
    $('#tbar').style.width = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
    if (left <= 0 && sess.status === 'pending') { stopTimer('expired'); cloud.expireRemote(sid).catch(() => {}); sess.status = 'expired'; render(); }
  };
  step(); tick = setInterval(step, 1000);
}
function stopTimer(status) { clearInterval(tick); tick = null; $('#timer').textContent = status === 'accepted' ? 'ACTIVE' : '00:00'; $('#timer').classList.remove('low'); $('#tbar').style.width = status === 'accepted' ? '100%' : '0%'; }

(async () => {
  if (!sid || sid.length < 24) { sess = null; render(); return; }
  try {
    await cloud.watchRemote(sid, (s) => {
      sess = s; if (sess && sess.status === 'pending') startTimer();
      render();
    }, (e) => { sess = null; render(); console.warn(e); });
  } catch (e) { sess = null; render(); }
})();
