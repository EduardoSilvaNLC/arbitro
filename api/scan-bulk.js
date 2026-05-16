export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { games } = req.body;
    if (!games || !Array.isArray(games) || games.length === 0)
        return res.status(400).json({ error: 'Nenhum jogo enviado' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
    };

    const promptB365 = (sport) => `Analyze this Bet365 screenshot for ${sport} player props O/U market.

Extract every player/pitcher name, their line, over odd and under odd.

Return ONLY a valid JSON array:
[{"name":"Player Name","team":"Team","linha":4.5,"over":1.62,"under":2.20}]

Rules:
- odds are decimals between 1.01 and 5.00 only
- linha is the over/under line number
- valid JSON only, no trailing commas
- if no markets found return empty array []`;

    const promptBF = (sport) => `Analyze this Betfair Sportsbook screenshot for ${sport} player props O/U market.

Extract every player/pitcher name, their line, over odd and under odd.
Lines on Betfair appear with + sign: "+5.5" means line is 5.5. Remove the + sign.

Return ONLY a valid JSON array:
[{"name":"Player Name","linha":5.5,"over":2.20,"under":1.57}]

Rules:
- odds are decimals between 1.01 and 5.00 only
- linha is the number after + sign (remove +)
- valid JSON only, no trailing commas
- if no markets found return empty array []`;

    const parseJSON = (data) => {
        try {
            let raw = data.content.map(c => c.text || '').join('').trim();
            raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
            const match = raw.match(/\[[\s\S]*\]/);
            if (!match) return [];
            return JSON.parse(match[0]);
        } catch { return []; }
    };

    const scanGame = async (game) => {
        try {
            const sport = game.sport || 'sports';
            const [resB365, resBF] = await Promise.all([
                fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST', headers,
                    body: JSON.stringify({
                        model: 'claude-sonnet-4-5',
                        max_tokens: 1000,
                        messages: [{
                            role: 'user', content: [
                                { type: 'image', source: { type: 'base64', media_type: game.b365Mime, data: game.b365Image } },
                                { type: 'text', text: promptB365(sport) }
                            ]
                        }]
                    })
                }),
                fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST', headers,
                    body: JSON.stringify({
                        model: 'claude-sonnet-4-5',
                        max_tokens: 1000,
                        messages: [{
                            role: 'user', content: [
                                { type: 'image', source: { type: 'base64', media_type: game.bfMime, data: game.bfImage } },
                                { type: 'text', text: promptBF(sport) }
                            ]
                        }]
                    })
                })
            ]);

            const [dataB365, dataBF] = await Promise.all([resB365.json(), resBF.json()]);
            const b365Players = parseJSON(dataB365);
            const bfPlayers = parseJSON(dataBF);

            const players = [];
            for (const b of b365Players) {
                if (!b.name) continue;
                const bfMatch = bfPlayers.find(bf =>
                    bf.name && bf.name.toLowerCase().trim() === b.name.toLowerCase().trim()
                );
                const b365linha = parseFloat(String(b.linha).replace('+', ''));
                const bflinha = bfMatch ? parseFloat(String(bfMatch.linha).replace('+', '')) : null;
                if (bfMatch && bflinha !== b365linha) continue;

                const bo = Math.max(b.over || 0, bfMatch?.over || 0);
                const bu = Math.max(b.under || 0, bfMatch?.under || 0);
                const margin = bo > 0 && bu > 0 ? (1 / bo + 1 / bu) : 1;
                const isArb = margin < 1;

                players.push({
                    name: b.name,
                    team: b.team || '',
                    sport: game.sport || '',
                    game: game.label || '',
                    linha: b365linha,
                    b365over: b.over || null,
                    b365under: b.under || null,
                    bfover: bfMatch?.over || null,
                    bfunder: bfMatch?.under || null,
                    margin: parseFloat((margin * 100).toFixed(1)),
                    isArb,
                    arbPct: isArb ? parseFloat(((1 - margin) * 100).toFixed(2)) : 0
                });
            }
            return { label: game.label, sport: game.sport, players };
        } catch (e) {
            return { label: game.label, sport: game.sport, players: [], error: e.message };
        }
    };

    try {
        const results = await Promise.all(games.map(scanGame));
        return res.status(200).json({ results });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}