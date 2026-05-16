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

    const prompt = `You are analyzing two betting site screenshots for MLB baseball pitcher props markets.
Image 1 = Bet365 (Pitcher Props tab). Image 2 = Betfair Sportsbook (Pitcher Total Strikeouts section).

Extract odds for pitcher strikeouts over/under markets for each pitcher.

IMPORTANT: All odds are in DECIMAL format between 1.01 and 5.00.
Numbers like 5.5, 6.5, 0.5, 3.5, 4.5 are the LINE (strikeouts), NOT odds.

Return ONLY a valid JSON array, no markdown, no explanation:
[{"name":"Pitcher Name","team":"Team","b365linha":5.5,"bflinha":5.5,"b365over":1.83,"b365under":1.90,"bfover":1.91,"bfunder":1.73}]

Rules:
- odds must be decimal numbers between 1.01 and 5.00 only
- b365linha = the exact line number shown on Bet365 for that pitcher
- bflinha = the exact line number shown on Betfair for that pitcher
- include ALL pitchers found on either site
- if pitcher only appears on one site, use null for missing odds and null for missing linha
- only pitcher strikeouts markets
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

        // remove jogadores com linhas diferentes entre as casas
        players = players.filter(p => {
            if (p.b365linha && p.bflinha) {
                return parseFloat(p.b365linha) === parseFloat(p.bflinha);
            }
            return true;
        });

        // normaliza: define linha única como a que existe
        players = players.map(p => ({
            ...p,
            linha: p.b365linha || p.bflinha
        }));

        return res.status(200).json({ players });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}