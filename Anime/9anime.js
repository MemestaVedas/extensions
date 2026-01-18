/**
 * ====================================================================
 * 9ANIME.ORG.LV EXTENSION
 * ====================================================================
 * 
 * 9anime.org.lv source extension for PLAY-ON!
 * Scrapes the WordPress-based 9anime sites.
 * ====================================================================
 */
const tauriFetch = fetch;
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer': 'https://9anime.org.lv/'
};

/**
 * Cleans image URLs by removing the wp.com CDN prefix and query parameters.
 * This bypasses "Tracking Prevention blocked access to storage" errors
 * caused by the browser blocking the wp.com CDN domain.
 * 
 * Example:
 *   Input:  https://i1.wp.com/9anime.org.lv/wp-content/uploads/2025/05/image.jpg?resize=247,350
 *   Output: https://9anime.org.lv/wp-content/uploads/2025/05/image.jpg
 */
function cleanUrl(url) {
    if (!url) return '';
    // Remove wp.com CDN prefix (e.g., https://i1.wp.com/ -> https://)
    let cleaned = url.replace(/^https?:\/\/i\d\.wp\.com\//, 'https://');
    // Remove query parameters (e.g., ?resize=247,350)
    const queryIndex = cleaned.indexOf('?');
    if (queryIndex !== -1) {
        cleaned = cleaned.substring(0, queryIndex);
    }
    return cleaned;
}

return {
    id: '9anime-org-lv',
    name: '9Anime (org.lv)',
    baseUrl: 'https://9anime.org.lv',
    lang: 'en',
    version: '1.0.0',
    iconUrl: 'https://9anime.org.lv/favicon.ico',
    async search(filter) {
        const query = filter.query || '';
        const page = filter.page || 1;
        // 9anime.org.lv uses standard WP search: /page/2/?s=query
        let url = `${this.baseUrl}/?s=${encodeURIComponent(query)}`;
        if (page > 1) {
            url = `${this.baseUrl}/page/${page}/?s=${encodeURIComponent(query)}`;
        }
        console.log(`[9Anime] Searching: ${url}`);
        const response = await tauriFetch(url, { headers: HEADERS });
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const anime = [];
        // Selectors based on inspection (typical WP layout)
        // Usually results are in .post or article tags
        const items = doc.querySelectorAll('article, .post, .result-item');
        items.forEach(item => {
            const titleEl = item.querySelector('h2 a') || item.querySelector('.title a') || item.querySelector('a');
            const imgEl = item.querySelector('img');
            if (titleEl) {
                const href = titleEl.getAttribute('href');
                if (href && href.includes('/anime/')) {
                    // Extract ID from /anime/id/
                    const idMatch = href.match(/\/anime\/([^\/]+)/);
                    if (idMatch) {
                        anime.push({
                            id: idMatch[1],
                            title: titleEl.textContent?.trim() || 'Unknown',
                            coverUrl: cleanUrl(imgEl?.getAttribute('src') || ''),
                            status: 'Unknown',
                            type: 'TV'
                        });
                    }
                }
            }
        });
        // Pagination
        const nextLink = doc.querySelector('.pagination .next, a.next');
        return { anime, hasNextPage: !!nextLink };
    },
    async getAnimeInfo(animeId) {
        // ID is the slug, e.g., "naruto-shippuuden-dub"
        // URL: /anime/naruto-shippuuden-dub/
        const url = `${this.baseUrl}/anime/${animeId}/`;
        console.log(`[9Anime] Info: ${url}`);
        const response = await tauriFetch(url, { headers: HEADERS });
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const title = doc.querySelector('h1.entry-title')?.textContent?.trim() ||
            doc.querySelector('h1')?.textContent?.trim() || 'Unknown';
        // Synopsis often in .entry-content p or .synopsis
        let description = '';
        const descEl = doc.querySelector('.entry-content p') || doc.querySelector('.synopsis');
        if (descEl) description = descEl.textContent?.trim();
        const rawCoverUrl = doc.querySelector('.entry-content img')?.getAttribute('src') ||
            doc.querySelector('.poster img')?.getAttribute('src') || '';
        return {
            id: animeId,
            title,
            coverUrl: cleanUrl(rawCoverUrl),
            description,
            status: 'Unknown'
        };
    },
    async getEpisodes(animeId) {
        // Episodes are typically listed on the anime page for these sites
        const url = `${this.baseUrl}/anime/${animeId}/`;
        const response = await tauriFetch(url, { headers: HEADERS });
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const episodes = [];
        // Look for episode links. Usually in a list <ul> or <div>
        // Link format: https://9anime.org.lv/episode-slug/
        // We need to filter for links that look like episodes matching this anime
        const links = doc.querySelectorAll('.entry-content a, .episodes-list a');
        links.forEach(link => {
            const href = link.getAttribute('href');
            const text = link.textContent?.trim();
            // Check if it's an episode link (usually contains the anime slug + 'episode')
            if (href && href.includes(animeId) && (href.includes('episode') || text.match(/^\d+$/))) {
                // Extract number
                let number = 0;
                // Try to get number from text (often just "1", "2")
                const textNum = parseInt(text);
                if (!isNaN(textNum)) {
                    number = textNum;
                } else {
                    // Try extract from URL
                    const match = href.match(/episode-(\d+)/);
                    if (match) number = parseInt(match[1]);
                }
                // ID is the full slug from the URL, simpler to use for fetching source later
                // e.g., https://9anime.org.lv/naruto-episode-1/ -> ID: naruto-episode-1
                const idMatch = href.match(/\/([^\/]+)\/?$/);
                if (idMatch) {
                    episodes.push({
                        id: idMatch[1],
                        number: number,
                        title: `Episode ${number}`,
                        url: href
                    });
                }
            }
        });
        // Deduplicate and sort
        const uniqueEpisodes = [];
        const seen = new Set();
        episodes.sort((a, b) => a.number - b.number).forEach(ep => {
            if (!seen.has(ep.number)) {
                seen.add(ep.number);
                uniqueEpisodes.push(ep);
            }
        });
        return uniqueEpisodes;
    },
    async getEpisodeSources(episodeId, _server) {
        // Episode ID is the slug, e.g., naruto-episode-1
        const url = `${this.baseUrl}/${episodeId}/`;
        console.log(`[9Anime] Sources: ${url}`);
        const response = await tauriFetch(url, { headers: HEADERS });
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const sources = [];
        // 1. Check for IFRAME
        const iframes = doc.querySelectorAll('iframe');
        iframes.forEach(iframe => {
            const src = iframe.getAttribute('src');
            if (src) {
                sources.push({
                    url: src,
                    quality: 'auto',
                    isM3U8: src.includes('.m3u8'),
                    isEmbed: true
                });
            }
        });
        // 2. Check for VIDEO tag
        const video = doc.querySelector('video source');
        if (video) {
            const src = video.getAttribute('src');
            if (src) {
                sources.push({
                    url: src,
                    quality: 'auto',
                    isM3U8: src.includes('.m3u8'),
                    isEmbed: false
                });
            }
        }
        if (sources.length === 0) {
            throw new Error('No sources found');
        }
        return {
            sources,
            headers: HEADERS
        };
    }
};