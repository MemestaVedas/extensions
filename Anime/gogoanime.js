/**
 * ====================================================================
 * GOGOANIME EXTENSION
 * ====================================================================
 * 
 * Gogoanime anime source extension for PLAY-ON!
 * Uses the anitaku.so API endpoints directly via Tauri HTTP plugin.
 * ====================================================================
 */
// Capture the Tauri fetch passed by the loader
const tauriFetch = fetch;
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};
return {
    id: 'gogoanime',
    name: 'Gogoanime',
    baseUrl: 'https://anitaku.so',
    apiUrl: 'https://ajax.gogocdn.net',
    lang: 'en',
    version: '1.1.0',
    iconUrl: 'https://anitaku.so/img/icon/logo.png',
    async search(filter) {
        const query = filter.query || '';
        const page = filter.page || 1;
        console.log('[Gogoanime] Searching:', query);
        try {
            const response = await tauriFetch(
                `${this.baseUrl}/search.html?keyword=${encodeURIComponent(query)}&page=${page}`,
                { headers: { ...HEADERS, 'Referer': this.baseUrl } }
            );
            if (!response.ok) throw new Error(`Search failed: ${response.status}`);
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const anime = [];
            doc.querySelectorAll('.items li').forEach(item => {
                const linkEl = item.querySelector('.name a');
                const imgEl = item.querySelector('.img img');
                const releasedEl = item.querySelector('.released');
                if (linkEl) {
                    const href = linkEl.getAttribute('href') || '';
                    const id = href.replace('/category/', '');
                    anime.push({
                        id,
                        title: linkEl.textContent?.trim() || 'Unknown',
                        coverUrl: imgEl?.getAttribute('src') || '',
                        releaseDate: releasedEl?.textContent?.replace('Released:', '').trim() || undefined,
                        url: `${this.baseUrl}${href}`
                    });
                }
            });
            const hasNextPage = !!doc.querySelector('.pagination-list li.selected + li a');
            return { anime, hasNextPage };
        } catch (error) {
            console.error('[Gogoanime] Search error:', error);
            throw error;
        }
    },
    async getAnimeInfo(animeId) {
        console.log('[Gogoanime] Getting info for:', animeId);
        try {
            const response = await tauriFetch(
                `${this.baseUrl}/category/${animeId}`,
                { headers: { ...HEADERS, 'Referer': this.baseUrl } }
            );
            if (!response.ok) throw new Error(`Failed to get anime info: ${response.status}`);
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const title = doc.querySelector('.anime_info_body_bg h1')?.textContent?.trim() || 'Unknown';
            const coverUrl = doc.querySelector('.anime_info_body_bg img')?.getAttribute('src') || '';
            const description = doc.querySelector('.description')?.textContent?.trim() || '';
            const genres = Array.from(doc.querySelectorAll('p.type:nth-child(6) a')).map(el => el.textContent.trim());
            const statusEl = doc.querySelector('p.type:nth-child(8) a');
            const status = statusEl?.textContent?.toLowerCase().includes('ongoing') ? 'ongoing' : 'completed';
            const movieId = doc.querySelector('#movie_id')?.getAttribute('value') || '';
            return { id: animeId, movieId, title, coverUrl, description, genres, status, url: `${this.baseUrl}/category/${animeId}` };
        } catch (error) {
            console.error('[Gogoanime] GetAnimeInfo error:', error);
            throw error;
        }
    },
    async getEpisodes(animeId) {
        console.log('[Gogoanime] Getting episodes for:', animeId);
        try {
            const infoRes = await tauriFetch(
                `${this.baseUrl}/category/${animeId}`,
                { headers: { ...HEADERS, 'Referer': this.baseUrl } }
            );
            if (!infoRes.ok) throw new Error(`Failed to get anime page: ${infoRes.status}`);
            const html = await infoRes.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const epStartEl = doc.querySelector('#episode_page a');
            const epEndEl = doc.querySelector('#episode_page a:last-child');
            const epStart = parseInt(epStartEl?.getAttribute('ep_start') || '0');
            const epEnd = parseInt(epEndEl?.getAttribute('ep_end') || '0');
            const movieId = doc.querySelector('#movie_id')?.getAttribute('value') || '';
            const alias = doc.querySelector('#alias_anime')?.getAttribute('value') || animeId;
            if (!movieId) {
                const episodes = [];
                doc.querySelectorAll('#episode_page a').forEach(el => {
                    const start = parseInt(el.getAttribute('ep_start') || '0');
                    const end = parseInt(el.getAttribute('ep_end') || '0');
                    for (let i = start; i <= end; i++) {
                        if (i === 0) continue;
                        episodes.push({ id: `${animeId}-episode-${i}`, number: i, title: `Episode ${i}` });
                    }
                });
                return episodes.sort((a, b) => a.number - b.number);
            }
            const ajaxRes = await tauriFetch(
                `${this.apiUrl}/ajax/load-list-episode?ep_start=${epStart}&ep_end=${epEnd}&id=${movieId}&default_ep=0&alias=${alias}`,
                { headers: { ...HEADERS, 'Referer': `${this.baseUrl}/category/${animeId}`, 'X-Requested-With': 'XMLHttpRequest' } }
            );
            if (!ajaxRes.ok) throw new Error(`Failed to get episodes: ${ajaxRes.status}`);
            const ajaxHtml = await ajaxRes.text();
            const ajaxDoc = new DOMParser().parseFromString(ajaxHtml, 'text/html');
            const episodes = [];
            ajaxDoc.querySelectorAll('li a').forEach(el => {
                const href = el.getAttribute('href')?.trim() || '';
                const epNumText = el.querySelector('.name')?.textContent?.replace('EP', '').trim() || '0';
                const epNum = parseInt(epNumText);
                const episodeId = href.replace('/', '').trim();
                episodes.push({ id: episodeId, number: epNum || episodes.length + 1, title: `Episode ${epNum || episodes.length + 1}` });
            });
            return episodes.sort((a, b) => a.number - b.number);
        } catch (error) {
            console.error('[Gogoanime] GetEpisodes error:', error);
            throw error;
        }
    },
    async getEpisodeSources(episodeId, _server) {
        console.log('[Gogoanime] Getting sources for:', episodeId);
        try {
            const response = await tauriFetch(
                `${this.baseUrl}/${episodeId}`,
                { headers: { ...HEADERS, 'Referer': this.baseUrl } }
            );
            if (!response.ok) throw new Error(`Failed to get episode page: ${response.status}`);
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const sources = [];
            // Download links with direct MP4
            doc.querySelectorAll('.dowloads a, .download-links a, .mirror_link a').forEach(el => {
                const href = el.getAttribute('href');
                const quality = el.textContent?.match(/(\d+P)/i)?.[1] || 'default';
                if (href && href.includes('.mp4')) {
                    sources.push({ url: href, quality, isM3U8: false });
                }
            });
            // Embedded player iframe
            const iframeEl = doc.querySelector('.play-video iframe, #load_anime iframe');
            if (iframeEl) {
                const iframeSrc = iframeEl.getAttribute('src');
                if (iframeSrc) {
                    sources.push({
                        url: iframeSrc.startsWith('//') ? `https:${iframeSrc}` : iframeSrc,
                        quality: 'default',
                        isM3U8: false,
                        server: 'embed'
                    });
                }
            }
            // M3U8 in scripts
            doc.querySelectorAll('script').forEach(script => {
                const content = script.textContent || '';
                const m3u8Match = content.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/);
                if (m3u8Match) {
                    sources.push({ url: m3u8Match[1], quality: 'auto', isM3U8: true });
                }
            });
            return { sources, headers: { 'Referer': this.baseUrl } };
        } catch (error) {
            console.error('[Gogoanime] GetEpisodeSources error:', error);
            throw error;
        }
    }
};