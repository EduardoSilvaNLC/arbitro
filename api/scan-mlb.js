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

    const prompt = `You are analyzing two betting site screenshots for MLB baseball pitcher strikeouts markets.
Image 1 = Bet365. Image 2 = Betfair.

Your job: for each pitcher, read the strikeout LINE and ODDS from each site separately.

HOW TO READ BET365 (Image 1):
- The line appears before the odds. Example: "4.5  1.62  2.20" means line=4.5, over=1.62, under=2.20
- Format is always: LINE  OVER_ODD  UNDER_ODD

HOW TO READ BETFAIR (Image 2):
- The line appears with a + sign inside the button. Example: "OVER +5.5  2.2" means line=5.5, over=2.2
- Always remove the + sign to get the line number
- "+4.5" = line 4.5, "+5.5" = line 5.5, "+2.5" = line 2.5

CRITICAL: Read each site independently. Do NOT assume the lines are the same.
Example: Bet365 may show Eduardo Rodriguez at 4.5 while Betfair shows him at +5.5 — these are DIFFERENT lines.

Return ONLY a valid JSON array:
[{"name":"Pitcher Name","team":"Team","b365linha":4.5,"bflinha":5.5,"b365over":1.62,"b365under":2.20,"bfover":2.20,"bfunder":1.57}]

Rules:
- odds are decimals between 1.01 and 5.00 only
- b365linha = line from Bet365 only
- bflinha = line from Betfair only (remove + sign)
- include ALL pitchers from both sites
- if pitcher missing from one site: use null for that site's odds and linha
- only strikeouts markets
- valid JSON only, no trailing commas`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5',
                max_tokens: 4000,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: b365Mime, data: b365Image } },
                        { type: 'image', source: { type: 'base64', media_type: bfMime, data: bfImage } },
                        { type: 'text', text: prompt }
                    ]
                }]
            })
        });

        const data = await response.json();
        if (data.error) return res.status(500).json({ error: data.error.message });

        let raw = data.content.map(c => c.text || '').join('').trim();
        raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();

        const match = raw.match(/\[[\s\S]*\]/);
        if (!match) return res.status(500).json({ error: 'IA não retornou JSON válido. Tente novamente.' });

        let players;
        try {
            players = JSON.parse(match[0]);
        } catch (parseErr) {
            return res.status(500).json({ error: 'JSON inválido: ' + parseErr.message });
        }

        // filtra nome válido
        players = players.filter(p => p && typeof p.name === 'string' && p.name.trim().length > 0);

        // remove pitchers com linhas diferentes — verificação no código
        players = players.filter(p => {
            if (p.b365linha != null && p.bflinha != null) {
                const l1 = parseFloat(String(p.b365linha).replace('+', ''));
                const l2 = parseFloat(String(p.bflinha).replace('+', ''));
                return l1 === l2;
            }
            return true;
        });

        // normaliza linha única
        players = players.map(p => ({
            ...p,
            linha: parseFloat(String(p.b365linha || p.bflinha).replace('+', ''))
        }));

        return res.status(200).json({ players });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}