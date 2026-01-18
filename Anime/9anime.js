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
        // Episode ID is the slug, e.g., one-piece-episode-1
        // Extract episode number from the slug
        const episodeMatch = episodeId.match(/episode[- ]?(\d+)/i);
        const episodeNum = episodeMatch ? parseInt(episodeMatch[1]) : 1;

        // Extract anime title from episode ID (remove episode part)
        const animeSlug = episodeId.replace(/-?episode[- ]?\d+$/i, '').trim();

        console.log(`[9Anime] Sources for: ${animeSlug} Episode ${episodeNum}`);

        // Try to get the page to find any AniList/MAL ID references
        const url = `${this.baseUrl}/${episodeId}/`;
        console.log(`[9Anime] Fetching page: ${url}`);

        try {
            const response = await tauriFetch(url, { headers: HEADERS });
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            // Check for direct VIDEO tag first
            const video = doc.querySelector('video source');
            if (video) {
                const src = video.getAttribute('src');
                if (src) {
                    console.log(`[9Anime] Found direct video source: ${src}`);
                    return {
                        sources: [{
                            url: src,
                            quality: 'auto',
                            isM3U8: src.includes('.m3u8'),
                            isEmbed: false
                        }],
                        headers: HEADERS
                    };
                }
            }

            // Look for MAL ID in the page (common in anime sites)
            const malMatch = html.match(/myanimelist\.net\/anime\/(\d+)/i) ||
                html.match(/mal[_-]?id["\s:=]+(\d+)/i);

            // Look for AniList ID
            const anilistMatch = html.match(/anilist\.co\/anime\/(\d+)/i) ||
                html.match(/anilist[_-]?id["\s:=]+(\d+)/i);

            // Use vidsrc.pro with whatever ID we found
            if (malMatch) {
                const malId = malMatch[1];
                const vidsrcUrl = `https://vidsrc.pro/embed/anime/mal/${malId}/${episodeNum}`;
                console.log(`[9Anime] Using vidsrc.pro with MAL ID: ${vidsrcUrl}`);
                return {
                    sources: [{
                        url: vidsrcUrl,
                        quality: 'auto',
                        isM3U8: false,
                        isEmbed: true
                    }],
                    headers: HEADERS
                };
            }

            if (anilistMatch) {
                const anilistId = anilistMatch[1];
                const vidsrcUrl = `https://vidsrc.pro/embed/anime/al/${anilistId}/${episodeNum}`;
                console.log(`[9Anime] Using vidsrc.pro with AniList ID: ${vidsrcUrl}`);
                return {
                    sources: [{
                        url: vidsrcUrl,
                        quality: 'auto',
                        isM3U8: false,
                        isEmbed: true
                    }],
                    headers: HEADERS
                };
            }

            // Fallback: Return any iframe on the page
            const iframes = doc.querySelectorAll('iframe');
            for (const iframe of iframes) {
                const src = iframe.getAttribute('src') || iframe.getAttribute('data-src');
                if (src && src.startsWith('http')) {
                    console.log(`[9Anime] Using existing iframe as fallback: ${src}`);
                    return {
                        sources: [{
                            url: src,
                            quality: 'auto',
                            isM3U8: false,
                            isEmbed: true
                        }],
                        headers: HEADERS
                    };
                }
            }
        } catch (err) {
            console.warn(`[9Anime] Error fetching episode page:`, err);
        }

        // Ultimate fallback: Use vidsrc.cc with title search
        // vidsrc.cc allows searching by title
        const vidsrcFallback = `https://vidsrc.cc/embed/anime?title=${encodeURIComponent(animeSlug.replace(/-/g, ' '))}&episode=${episodeNum}`;
        console.log(`[9Anime] Using vidsrc.cc title search fallback: ${vidsrcFallback}`);

        return {
            sources: [{
                url: vidsrcFallback,
                quality: 'auto',
                isM3U8: false,
                isEmbed: true
            }],
            headers: HEADERS
        };
    }
};
