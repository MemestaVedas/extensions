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
        // ID is the slug, e.g., "one-piece"
        // URL: /anime/one-piece/
        const url = `${this.baseUrl}/anime/${animeId}/`;
        console.log(`[9Anime] Info: ${url}`);
        const response = await tauriFetch(url, { headers: HEADERS });
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // Title extraction - try multiple selectors
        const title = doc.querySelector('h1.entry-title')?.textContent?.trim() ||
            doc.querySelector('.entry-header h1')?.textContent?.trim() ||
            doc.querySelector('h1')?.textContent?.trim() || 'Unknown';

        // Synopsis - look for common synopsis containers
        let description = '';
        const descContainers = doc.querySelectorAll('.entry-content p, .synopsis, .description, [class*="synopsis"] p');
        for (const el of descContainers) {
            const text = el.textContent?.trim();
            // Get the first substantial paragraph (more than 50 chars)
            if (text && text.length > 50) {
                description = text;
                break;
            }
        }

        // Cover image - try multiple possible selectors
        let rawCoverUrl = '';
        const imgSelectors = [
            '.poster img',
            '.film-poster img',
            '.thumb img',
            '.cover img',
            'article img',
            '.entry-content img',
            'img[data-src]',
            'img[src*="upload"]',
            'img[src*="poster"]'
        ];
        for (const selector of imgSelectors) {
            const img = doc.querySelector(selector);
            if (img) {
                rawCoverUrl = img.getAttribute('data-src') || img.getAttribute('src') || '';
                if (rawCoverUrl && !rawCoverUrl.includes('avatar') && !rawCoverUrl.includes('icon')) {
                    break;
                }
            }
        }

        return {
            id: animeId,
            title,
            coverUrl: cleanUrl(rawCoverUrl),
            description,
            status: 'Unknown'
        };
    },
    async getEpisodes(animeId) {
        // Episodes are listed on the anime page
        const url = `${this.baseUrl}/anime/${animeId}/`;
        console.log(`[9Anime] Episodes: ${url}`);
        const response = await tauriFetch(url, { headers: HEADERS });
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const episodes = [];

        // 9anime.org.lv has episode links at root level: /anime-name-episode-X/
        // Get all links on the page and filter for episode links
        const links = doc.querySelectorAll('a[href]');
        links.forEach(link => {
            const href = link.getAttribute('href') || '';
            const text = link.textContent?.trim() || '';

            // Episode links contain "episode" and a number in the URL
            // Pattern: /{anime-slug}-episode-{number}/ or /episode-{number}/
            const episodeMatch = href.match(/episode[- ]?(\d+)/i);
            if (episodeMatch) {
                const number = parseInt(episodeMatch[1]);
                // Extract the episode slug from the URL
                const slugMatch = href.match(/\/([^\/]+)\/?$/);
                if (slugMatch) {
                    episodes.push({
                        id: slugMatch[1],
                        number: number,
                        title: text || `Episode ${number}`,
                        url: href
                    });
                }
            }
        });

        // Deduplicate by episode number and sort
        const uniqueEpisodes = [];
        const seen = new Set();
        episodes.sort((a, b) => a.number - b.number).forEach(ep => {
            if (!seen.has(ep.number)) {
                seen.add(ep.number);
                uniqueEpisodes.push(ep);
            }
        });

        console.log(`[9Anime] Found ${uniqueEpisodes.length} episodes`);
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