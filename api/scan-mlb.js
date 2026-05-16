export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { b365Image, bfImage, b365Mime, bfMime } = req.body;
    if (!b365Image || !bfImage) return res.status(400).json({ error: 'Missing images' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured on Vercel' });

    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
    };

    const promptB365 = `Analyze this Bet365 screenshot for MLB pitcher strikeouts O/U market.

Extract every pitcher's strikeout line and odds.
The format on Bet365 is: PITCHER NAME on left, then LINE number, then OVER odd, then UNDER odd.
Example: "Eduardo Rodriguez  4.5  1.62  2.20" means line=4.5, over=1.62, under=2.20

Return ONLY a valid JSON array:
[{"name":"Pitcher Name","team":"Team abbreviation","linha":4.5,"over":1.62,"under":2.20}]

Rules:
- odds are decimals between 1.01 and 5.00 only
- linha is the strikeout line (e.g. 2.5, 3.5, 4.5, 5.5)
- only strikeouts market
- valid JSON only, no trailing commas`;

    const promptBF = `Analyze this Betfair Sportsbook screenshot for MLB Pitcher Total Strikeouts market.

Extract every pitcher's strikeout line and odds.
On Betfair the line appears inside the button with a + sign: "OVER +5.5  2.2" means line=5.5, over=2.2
Always remove the + sign to get the line number.

Return ONLY a valid JSON array:
[{"name":"Pitcher Name","linha":5.5,"over":2.20,"under":1.57}]

Rules:
- odds are decimals between 1.01 and 5.00 only
- linha is the number after + sign (e.g. +4.5 = 4.5, +5.5 = 5.5)
- only strikeouts market
- valid JSON only, no trailing commas`;

    try {
        // duas chamadas separadas — uma por imagem
        const [resB365, resBF] = await Promise.all([
            fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: 'claude-sonnet-4-5',
                    max_tokens: 1000,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'image', source: { type: 'base64', media_type: b365Mime, data: b365Image } },
                            { type: 'text', text: promptB365 }
                        ]
                    }]
                })
            }),
            fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: 'claude-sonnet-4-5',
                    max_tokens: 1000,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'image', source: { type: 'base64', media_type: bfMime, data: bfImage } },
                            { type: 'text', text: promptBF }
                        ]
                    }]
                })
            })
        ]);

        const [dataB365, dataBF] = await Promise.all([resB365.json(), resBF.json()]);

        if (dataB365.error) return res.status(500).json({ error: 'Bet365: ' + dataB365.error.message });
        if (dataBF.error) return res.status(500).json({ error: 'Betfair: ' + dataBF.error.message });

        const parseJSON = (data) => {
            let raw = data.content.map(c => c.text || '').join('').trim();
            raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
            const match = raw.match(/\[[\s\S]*\]/);
            if (!match) return [];
            try { return JSON.parse(match[0]); } catch { return []; }
        };

        const b365Players = parseJSON(dataB365);
        const bfPlayers = parseJSON(dataBF);

        // cruza os dois arrays pelo nome
        const players = [];

        for (const b of b365Players) {
            if (!b.name) continue;
            const bfMatch = bfPlayers.find(bf =>
                bf.name && bf.name.toLowerCase().trim() === b.name.toLowerCase().trim()
            );

            const b365linha = parseFloat(String(b.linha).replace('+', ''));
            const bflinha = bfMatch ? parseFloat(String(bfMatch.linha).replace('+', '')) : null;

            // só inclui se linhas forem iguais
            if (bfMatch && bflinha !== b365linha) continue;

            players.push({
                name: b.name,
                team: b.team || '',
                linha: b365linha,
                b365over: b.over || null,
                b365under: b.under || null,
                bfover: bfMatch?.over || null,
                bfunder: bfMatch?.under || null
            });
        }

        return res.status(200).json({ players });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}