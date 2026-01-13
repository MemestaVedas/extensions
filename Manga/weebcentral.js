/**
 * WeebCentral Extension Bundle
 * 
 * This is a bundled JavaScript version of the WeebCentral extension
 * for use with the PLAY-ON! dynamic extension system.
 * 
 * Bundle format: IIFE that accepts `fetch` as a parameter and returns the extension object.
 */

return {
    id: 'weebcentral',
    name: 'WeebCentral',
    version: '1.0.0',
    baseUrl: 'https://weebcentral.com',
    lang: 'en',

    async search(filter) {
        try {
            const query = filter.query || '';
            const url = `${this.baseUrl}/search/data?text=${encodeURIComponent(query)}&sort=Best+Match&order=Descending&official=Any&display_mode=Full+Display`;

            console.log('[WeebCentral] Fetching search data:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://weebcentral.com/search',
                    'HX-Request': 'true'
                }
            });

            console.log('[WeebCentral] Response status:', response.status);

            if (!response.ok) {
                console.error(`[WeebCentral] Search fetch failed: ${response.status} ${response.statusText}`);
                return { manga: [], hasNextPage: false };
            }

            const html = await response.text();
            console.log('[WeebCentral] HTML fragment length:', html.length);

            if (html.includes('Just a moment') || html.includes('Checking your browser')) {
                console.error('[WeebCentral] Cloudflare block detected!');
                return { manga: [], hasNextPage: false };
            }

            const doc = new DOMParser().parseFromString(html, 'text/html');
            const results = [];
            const mangaCards = Array.from(doc.querySelectorAll('a[href*="/series/"]'));
            console.log('[WeebCentral] Found manga cards:', mangaCards.length);

            for (const card of mangaCards) {
                const href = card.getAttribute('href');
                if (!href) continue;

                const match = href.match(/\/series\/([^\/]+)/);
                const id = match ? match[1] : null;
                if (!id) continue;

                let title = '';
                const titleSelectors = [
                    'a.link.link-hover', '.line-clamp-1', '.line-clamp-2',
                    '[class*="title"]', 'h1, h2, h3, h4, h5', 'strong',
                    'span.font-bold', 'p.font-bold'
                ];

                for (const selector of titleSelectors) {
                    const el = card.querySelector(selector);
                    if (el && el.textContent?.trim()) {
                        const text = el.textContent.trim();
                        if (!text.match(/^\d+$/) && !text.toLowerCase().includes('chapter')) {
                            title = text;
                            break;
                        }
                    }
                }

                if (!title || title === 'Unknown Title') {
                    const slugMatch = href.match(/\/series\/[^\/]+\/(.+)/);
                    if (slugMatch && slugMatch[1]) {
                        title = slugMatch[1].replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
                    }
                }

                if (!title || title === 'Unknown Title') {
                    const clone = card.cloneNode(true);
                    clone.querySelectorAll('img, svg, picture, style').forEach(el => el.remove());
                    const allText = clone.textContent?.trim() || '';
                    const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 3);
                    if (lines.length > 0) title = lines[0];
                }

                if (!title) title = 'Unknown Title';

                const img = card.querySelector('picture img') || card.querySelector('img');
                let coverUrl = img?.getAttribute('src') || '';
                if (coverUrl && !coverUrl.startsWith('http')) {
                    coverUrl = new URL(coverUrl, this.baseUrl).href;
                }

                if (results.some(r => r.id === id)) continue;

                results.push({ id, title, coverUrl, status: 'unknown' });
                console.log(`[WeebCentral] Found: ${title} (${id})`);
            }

            console.log('[WeebCentral] Total results:', results.length);
            return { manga: results, hasNextPage: false };
        } catch (error) {
            console.error('[WeebCentral] Search failed:', error);
            return { manga: [], hasNextPage: false };
        }
    },

    async getMangaDetails(id) {
        try {
            const url = `${this.baseUrl}/series/${id}/placeholder`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://weebcentral.com/'
                }
            });
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            const title = doc.querySelector('h1')?.textContent?.trim() || 'Unknown Title';
            const coverUrl = doc.querySelector('img[alt="' + title + '"]')?.getAttribute('src') ||
                doc.querySelector('picture > img')?.getAttribute('src') || '';
            const description = doc.querySelector('.description, .prose')?.textContent?.trim() || '';
            const authorLink = doc.querySelector('a[href*="author="]');
            const author = authorLink?.textContent?.trim() || '';

            let status = 'unknown';
            let statusText = '';
            const statusLabel = Array.from(doc.querySelectorAll('span, div, strong')).find(el => el.textContent?.includes('Status:'));
            if (statusLabel && statusLabel.nextSibling) {
                statusText = statusLabel.nextSibling.textContent?.trim() || '';
            } else if (statusLabel && statusLabel.nextElementSibling) {
                statusText = statusLabel.nextElementSibling.textContent?.trim() || '';
            }

            if (statusText.toLowerCase().includes('ongoing')) status = 'ongoing';
            else if (statusText.toLowerCase().includes('complete')) status = 'completed';
            else if (statusText.toLowerCase().includes('hiatus')) status = 'hiatus';
            else if (statusText.toLowerCase().includes('cancel')) status = 'cancelled';

            return { id, title, coverUrl, description, author, status };
        } catch (error) {
            console.error('[WeebCentral] Failed to get details:', error);
            throw error;
        }
    },

    async getChapters(mangaId) {
        try {
            const url = `${this.baseUrl}/series/${mangaId}/full-chapter-list`;
            console.log('[WeebCentral] Fetching chapters from:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Referer': `https://weebcentral.com/series/${mangaId}`,
                    'HX-Request': 'true'
                }
            });

            console.log('[WeebCentral] Chapters response status:', response.status);
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            const chapters = [];
            const chapterLinks = Array.from(doc.querySelectorAll('a[href*="/chapters/"]'));
            console.log('[WeebCentral] Found chapter links:', chapterLinks.length);

            for (const link of chapterLinks) {
                const href = link.getAttribute('href');
                if (!href) continue;

                const match = href.match(/\/chapters\/([^\/]+)/);
                const id = match ? match[1] : null;
                if (!id) continue;
                if (chapters.some(c => c.id === id)) continue;

                let name = '';
                const spans = link.querySelectorAll('span');
                for (const span of spans) {
                    if (span.querySelector('svg, style')) continue;
                    const text = span.textContent?.trim() || '';
                    if (text.includes('{') || text.includes('fill:') || text.includes('.st')) continue;
                    if (text.toLowerCase().includes('chapter')) {
                        name = text;
                        break;
                    }
                }

                if (!name) {
                    const clone = link.cloneNode(true);
                    clone.querySelectorAll('svg, style').forEach(el => el.remove());
                    name = clone.textContent?.trim() || '';
                    if (name.includes('{') || name.includes('.st')) {
                        const chapterMatch = name.match(/Chapter\s*\d+(\.\d+)?/i);
                        name = chapterMatch ? chapterMatch[0] : 'Chapter';
                    }
                }

                if (!name) name = 'Chapter';

                const numMatch = name.match(/Chapter\s*(\d+(\.\d+)?)/i);
                const number = numMatch ? parseFloat(numMatch[1]) : chapters.length + 1;

                chapters.push({ id, number, title: `Chapter ${number}` });
            }

            console.log('[WeebCentral] Parsed chapters:', chapters.length);
            return chapters;
        } catch (error) {
            console.error('[WeebCentral] Failed to get chapters:', error);
            return [];
        }
    },

    async getPages(chapterId) {
        try {
            const url = `${this.baseUrl}/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`;
            console.log('[WeebCentral] Fetching pages from:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Referer': `https://weebcentral.com/chapters/${chapterId}`,
                    'HX-Request': 'true'
                }
            });

            console.log('[WeebCentral] Pages response status:', response.status);
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const pages = [];

            let images = Array.from(doc.querySelectorAll('img'));
            console.log('[WeebCentral] Found all images:', images.length);

            const targetImages = images.filter(img => {
                const src = img.getAttribute('src') || '';
                return (src.includes('compsci88.com') ||
                    src.includes('planeptune.us') ||
                    src.includes('/manga/') ||
                    src.includes('/chapter/')) &&
                    !src.includes('avatar') &&
                    !src.includes('icon') &&
                    !src.includes('logo');
            });

            console.log('[WeebCentral] Filtered manga images:', targetImages.length);

            targetImages.forEach((img, index) => {
                let src = img.getAttribute('src') || '';
                if (src && !src.startsWith('http')) {
                    src = new URL(src, this.baseUrl).href;
                }
                if (src) {
                    pages.push({ index, imageUrl: src });
                }
            });

            console.log('[WeebCentral] Final pages count:', pages.length);
            return pages;
        } catch (error) {
            console.error('[WeebCentral] Failed to get pages:', error);
            return [];
        }
    }
};
