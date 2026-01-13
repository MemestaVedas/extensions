/**
 * ====================================================================
 * ANIMEPAHE EXTENSION
 * ====================================================================
 * 
 * AnimePahe anime source extension for PLAY-ON!
 * Uses animepahe.ru with Tauri HTTP plugin for CORS bypass.
 * ====================================================================
 */
// Capture the Tauri fetch passed by the loader
const tauriFetch = fetch;
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://animepahe.si/'
};
// Extract stream URL from Kwik embed
async function extractKwik(url) {
    try {
        console.log('[AnimePahe] Extracting from kwik:', url);
        const response = await tauriFetch(url, {
            headers: { ...HEADERS, 'Referer': 'https://animepahe.ru/' }
        });
        const html = await response.text();
        // Find the eval/packed script
        const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]+?\)\)/);
        if (!packedMatch) {
            // Try to find direct m3u8 link
            const m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
            if (m3u8Match) {
                return { url: m3u8Match[0], isM3U8: true };
            }
            // Try to find mp4 link
            const mp4Match = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
            if (mp4Match) {
                return { url: mp4Match[0], isM3U8: false };
            }
            throw new Error('Could not find stream URL in kwik page');
        }
        // Simple unpacker for p,a,c,k,e,d format
        const packed = packedMatch[0];
        const urlMatch = packed.match(/https?:\\\/\\\/[^"'\s]+/g);
        if (urlMatch) {
            for (const match of urlMatch) {
                const cleanUrl = match.replace(/\\\//g, '/');
                if (cleanUrl.includes('.m3u8') || cleanUrl.includes('.mp4')) {
                    return { url: cleanUrl, isM3U8: cleanUrl.includes('.m3u8') };
                }
            }
        }
        throw new Error('Could not extract stream URL');
    } catch (err) {
        console.error('[AnimePahe] Kwik extraction failed:', err);
        return null;
    }
}
return {
    id: 'animepahe',
    name: 'AnimePahe',
    baseUrl: 'https://animepahe.si',
    apiUrl: 'https://animepahe.si/api',
    lang: 'en',
    version: '1.1.0',
    iconUrl: 'https://animepahe.si/favicon.ico',
    async search(filter) {
        const query = filter.query || '';
        console.log('[AnimePahe] Searching:', query);
        try {
            const response = await tauriFetch(
                `${this.apiUrl}?m=search&q=${encodeURIComponent(query)}`,
                { headers: { ...HEADERS, 'Accept': 'application/json' } }
            );
            if (!response.ok) throw new Error(`Search failed: ${response.status}`);
            const data = await response.json();
            if (!data || !data.data) return { anime: [], hasNextPage: false };
            const anime = data.data.map(item => ({
                id: item.session,
                title: item.title,
                coverUrl: item.poster || '',
                type: item.type || 'TV',
                episodes: item.episodes || 0,
                status: item.status?.toLowerCase() || 'unknown',
                year: item.year || undefined
            }));
            console.log(`[AnimePahe] Found ${anime.length} results`);
            return { anime, hasNextPage: false };
        } catch (error) {
            console.error('[AnimePahe] Search error:', error);
            return { anime: [], hasNextPage: false };
        }
    },
    async getAnimeInfo(animeId) {
        console.log('[AnimePahe] Getting info for:', animeId);
        try {
            const response = await tauriFetch(
                `${this.baseUrl}/anime/${animeId}`,
                { headers: HEADERS }
            );
            if (!response.ok) throw new Error(`Failed to get anime info: ${response.status}`);
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const title = doc.querySelector('.title-wrapper h1 span')?.textContent?.trim() || 'Unknown';
            const coverUrl = doc.querySelector('.anime-poster img')?.getAttribute('src') || '';
            const description = doc.querySelector('.anime-synopsis')?.textContent?.trim() || '';
            const genres = Array.from(doc.querySelectorAll('.anime-genre a')).map(el => el.textContent.trim());
            return { id: animeId, title, coverUrl, description, genres, status: 'unknown' };
        } catch (error) {
            console.error('[AnimePahe] GetAnimeInfo error:', error);
            throw error;
        }
    },
    async getEpisodes(animeId) {
        console.log('[AnimePahe] Getting episodes for:', animeId);
        try {
            const allEpisodes = [];
            let page = 1;
            let hasMore = true;
            while (hasMore) {
                const response = await tauriFetch(
                    `${this.apiUrl}?m=release&id=${animeId}&sort=episode_asc&page=${page}`,
                    { headers: { ...HEADERS, 'Accept': 'application/json' } }
                );
                if (!response.ok) break;
                const data = await response.json();
                if (!data || !data.data || data.data.length === 0) break;
                data.data.forEach(ep => {
                    allEpisodes.push({
                        id: ep.session,
                        number: ep.episode || allEpisodes.length + 1,
                        title: `Episode ${ep.episode}`,
                        snapshot: ep.snapshot || undefined,
                        duration: ep.duration || undefined
                    });
                });
                hasMore = page < (data.last_page || 1);
                page++;
                // Safety limit
                if (page > 50) break;
            }
            console.log(`[AnimePahe] Found ${allEpisodes.length} episodes`);
            return allEpisodes;
        } catch (error) {
            console.error('[AnimePahe] GetEpisodes error:', error);
            return [];
        }
    },
    async getEpisodeSources(episodeId, _server) {
        console.log('[AnimePahe] Getting sources for:', episodeId);
        try {
            const response = await tauriFetch(
                `${this.apiUrl}?m=links&id=${episodeId}&p=kwik`,
                { headers: { ...HEADERS, 'Accept': 'application/json' } }
            );
            if (!response.ok) throw new Error(`Failed to get sources: ${response.status}`);
            const data = await response.json();
            if (!data || !data.data || data.data.length === 0) {
                throw new Error('No sources found');
            }
            // Try each quality until one works
            const qualities = data.data.sort((a, b) => (b.resolution || 0) - (a.resolution || 0));
            for (const quality of qualities) {
                const kwikUrl = quality.kwik;
                if (!kwikUrl) continue;
                const extracted = await extractKwik(kwikUrl);
                if (extracted) {
                    return {
                        sources: [{
                            url: extracted.url,
                            quality: `${quality.resolution || 'auto'}p`,
                            isM3U8: extracted.isM3U8
                        }],
                        headers: { 'Referer': 'https://kwik.si/', 'Origin': 'https://kwik.si' }
                    };
                }
            }
            throw new Error('All sources failed');
        } catch (error) {
            console.error('[AnimePahe] GetEpisodeSources error:', error);
            throw error;
        }
    }
};