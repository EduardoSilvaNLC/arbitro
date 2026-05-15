const imgs = { b365: null, bf: null };
let players = [], activeFilter = 'all';

function loadImg(casa, input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        imgs[casa] = { data: e.target.result, mime: file.type || 'image/png' };
        const dz = document.getElementById('dz-' + casa);
        dz.classList.add('ready');
        document.getElementById('l-' + casa).textContent = file.name.length > 22 ? file.name.slice(0, 20) + '...' : file.name;
        const old = dz.querySelector('.dz-prev'); if (old) old.remove();
        const img = document.createElement('img'); img.className = 'dz-prev'; img.src = e.target.result;
        dz.appendChild(img);
        checkReady();
    };
    reader.readAsDataURL(file);
}

function checkReady() {
    document.getElementById('scanBtn').disabled = !(imgs.b365 && imgs.bf);
}

function b64(d) { return d.split(',')[1]; }

function setStatus(type, msg) {
    const icon = type === 'loading' ? '<div class="spin"></div>' : `<span>${type === 'ok' ? '✓' : '✕'}</span>`;
    document.getElementById('statusArea').innerHTML = `<div class="status ${type}">${icon}<span>${msg}</span></div>`;
}

async function scan() {
    document.getElementById('scanBtn').disabled = true;
    document.getElementById('resultsArea').innerHTML = '';
    setStatus('loading', 'IA analisando os prints — aguarde...');
    try {
        const res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                b365Image: b64(imgs.b365.data), b365Mime: imgs.b365.mime,
                bfImage: b64(imgs.bf.data), bfMime: imgs.bf.mime
            })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        players = data.players.filter(p => p && p.name);
        const arbN = players.filter(p => calcArb(p)?.isArb).length;
        setStatus('ok', `${players.length} jogadores · ${arbN} arbitragem${arbN !== 1 ? 's' : ''} encontrada${arbN !== 1 ? 's' : ''}`);
        renderAll();
    } catch (e) {
        setStatus('error', 'Erro: ' + e.message);
        document.getElementById('scanBtn').disabled = false;
    }
}

function calcArb(p) {
    if (!p || !p.b365over || !p.b365under || !p.bfover || !p.bfunder) return null;
    const bo = Math.max(p.b365over, p.bfover);
    const bu = Math.max(p.b365under, p.bfunder);
    const m = 1 / bo + 1 / bu;
    return {
        bo, bu, m,
        oc: p.b365over >= p.bfover ? 'Bet365' : 'Betfair',
        uc: p.b365under >= p.bfunder ? 'Bet365' : 'Betfair',
        isArb: m < 1,
        pct: ((1 - m) * 100).toFixed(2),
        mpct: (m * 100).toFixed(1)
    };
}

function setFilter(f, btn) {
    activeFilter = f;
    document.querySelectorAll('.fb').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    renderList();
}

function renderAll() {
    const arbs = players.filter(p => calcArb(p)?.isArb);
    const best = arbs.length
        ? arbs.reduce((a, b) => {
            const ca = calcArb(a), cb = calcArb(b);
            if (!ca) return b;
            if (!cb) return a;
            return ca.m < cb.m ? a : b;
        })
        : null;

    const markets = ['all', 'points', 'assists', 'rebounds', 'threes'];
    const marketLabels = { all: 'Todos', points: 'Pontos', assists: 'Assists', rebounds: 'Rebotes', threes: '3PM' };

    document.getElementById('resultsArea').innerHTML = `
    <div class="summary">
      <div class="sm"><div class="sm-lbl">Jogadores</div><div class="sm-val">${players.length}</div></div>
      <div class="sm"><div class="sm-lbl">Arbitragens</div><div class="sm-val g">${arbs.length}</div></div>
      <div class="sm"><div class="sm-lbl">Melhor</div><div class="sm-val" style="font-size:1.1rem;padding-top:6px;">${best ? best.name.split(' ').slice(-1)[0] : '—'}</div></div>
    </div>
    <div class="filters">
      ${markets.map(m => `<button class="fb ${m === 'all' ? 'on' : ''}" onclick="setFilter('${m}',this)">${marketLabels[m]}</button>`).join('')}
      <button class="fb" onclick="setFilter('arb',this)">Só arb</button>
    </div>
    <div id="plist"></div>
    <button class="reset-btn" onclick="resetAll()">↺ Novo scan</button>`;
    renderList();
}

function renderList() {
    const list = players.filter(p => {
        if (!p) return false;
        if (activeFilter === 'arb') return calcArb(p)?.isArb;
        if (activeFilter === 'all') return true;
        return p.market === activeFilter;
    });
    window._L = list;
    document.getElementById('plist').innerHTML = list.map((p, i) => card(p, i)).join('');
    list.forEach((p, i) => { if (calcArb(p)?.isArb) updStake(i, 200); });
}

function card(p, i) {
    if (!p) return '';
    const a = calcArb(p);
    const ini = (p.name || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const noData = !p.bfover || !p.b365over;
    const marketLabel = { points: 'PTS', assists: 'AST', rebounds: 'REB', threes: '3PM' };
    const mkt = marketLabel[p.market] || p.market || '?';

    let body = noData
        ? `<div class="no-data">Betfair sem odds para este jogador — rola a página e manda novo print.</div>`
        : `<div class="og">
        <div class="ob"><div class="ob-src b">Bet365</div>
          <div class="ob-row"><span class="ob-lbl">Over ${p.linha}</span><span class="ob-v ${p.b365over >= (p.bfover || 0) ? 'best' : ''}">${p.b365over?.toFixed(2)}</span></div>
          <div class="ob-row"><span class="ob-lbl">Under ${p.linha}</span><span class="ob-v ${p.b365under >= (p.bfunder || 0) ? 'best' : ''}">${p.b365under?.toFixed(2)}</span></div>
        </div>
        <div class="ob"><div class="ob-src f">Betfair</div>
          <div class="ob-row"><span class="ob-lbl">Over ${p.linha}</span><span class="ob-v ${(p.bfover || 0) > p.b365over ? 'best' : ''}">${p.bfover?.toFixed(2) ?? '—'}</span></div>
          <div class="ob-row"><span class="ob-lbl">Under ${p.linha}</span><span class="ob-v ${(p.bfunder || 0) > p.b365under ? 'best' : ''}">${p.bfunder?.toFixed(2) ?? '—'}</span></div>
        </div>
      </div>
      <div class="ms ${a && a.isArb ? 'y' : 'n'}">
        <span>${a && a.isArb ? `✓ Arb ${a.pct}% — over ${a.oc} · under ${a.uc}` : `✗ Sem arb · margem ${a ? a.mpct : '—'}%`}</span>
        <span class="ms-v">${a ? a.mpct : '—'}%</span>
      </div>
      ${a && a.isArb ? `<div class="sb">
        <div class="sb-t">Quanto apostar</div>
        <div class="sb-row"><label>Total R$</label>
          <input class="sb-inp" type="number" value="200" min="10" step="10" id="si${i}" oninput="updStake(${i},this.value)"/>
        </div>
        <div class="sr" id="sr${i}"></div>
      </div>` : ''}`;

    return `<div class="pc ${a && a.isArb ? 'arb' : ''}" style="animation-delay:${i * 0.04}s">
    <div class="pc-top">
      <div class="av">${ini}</div>
      <div>
        <div class="pc-name">${p.name || '?'}</div>
        <div class="pc-meta">${p.team || ''} · ${p.linha || '?'} ${mkt}</div>
      </div>
      ${a && a.isArb ? '<span class="arb-badge">arb found</span>' : ''}
    </div>${body}</div>`;
}

function updStake(i, total) {
    const p = window._L?.[i]; if (!p) return;
    const a = calcArb(p); if (!a || !a.isArb) return;
    const t = parseFloat(total) || 200;
    const s1 = t * (1 / a.bo) / a.m, s2 = t - s1;
    const r1 = s1 * a.bo - t, r2 = s2 * a.bu - t;
    const el = document.getElementById('sr' + i); if (!el) return;
    el.innerHTML = `
    <div class="sri"><div class="sri-l">${a.oc} over</div><div class="sri-v">R$ ${s1.toFixed(2)}</div></div>
    <div class="sri"><div class="sri-l">${a.uc} under</div><div class="sri-v">R$ ${s2.toFixed(2)}</div></div>
    <div class="sri"><div class="sri-l">Lucro mín.</div><div class="sri-v">R$ ${Math.min(r1, r2).toFixed(2)}</div></div>`;
}

function resetAll() {
    imgs.b365 = null; imgs.bf = null; players = [];
    ['b365', 'bf'].forEach(c => {
        const dz = document.getElementById('dz-' + c);
        dz.classList.remove('ready');
        const prev = dz.querySelector('.dz-prev'); if (prev) prev.remove();
        document.getElementById('l-' + c).textContent = 'Print de assistências';
        document.getElementById('i-' + c).value = '';
    });
    document.getElementById('scanBtn').disabled = true;
    document.getElementById('statusArea').innerHTML = '';
    document.getElementById('resultsArea').innerHTML = '';
}