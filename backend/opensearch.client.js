export default class OpenSearchClient {
    constructor(node, username, password, mode = 'direct', index = '*') {
        this.node = node;
        this.username = username || '';
        this.password = password || '';
        this.mode = mode || 'direct';
        this.index = index || '*';
    }

    _buildAuthHeader() {
        if (!this.username || !this.password) {
            return null;
        }
        return `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
    }

    async _request(path, method = 'GET', body = null) {
        if (!this.node) {
            throw new Error('OPENSEARCH_NODE is not configured.');
        }

        const authHeader = this._buildAuthHeader();

        if (this.mode === 'dashboards_proxy') {
            const url = new URL('/api/console/proxy', this.node);
            url.searchParams.set('path', path);
            url.searchParams.set('method', method);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'osd-xsrf': 'true',
                    ...(authHeader ? { Authorization: authHeader } : {}),
                },
                body: body ? JSON.stringify(body) : undefined,
            });

            const contentType = response.headers.get('content-type') || '';
            const payload = contentType.includes('application/json')
                ? await response.json()
                : await response.text();

            if (!response.ok) {
                throw new Error(
                    `OpenSearch proxy request failed (${response.status}): ${
                        typeof payload === 'string' ? payload.slice(0, 300) : JSON.stringify(payload).slice(0, 300)
                    }`
                );
            }

            return payload;
        }

        const url = new URL(path.replace(/^\//, ''), this.node.endsWith('/') ? this.node : `${this.node}/`);
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(authHeader ? { Authorization: authHeader } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        const contentType = response.headers.get('content-type') || '';
        const payload = contentType.includes('application/json')
            ? await response.json()
            : await response.text();

        if (!response.ok) {
            throw new Error(
                `OpenSearch request failed (${response.status}): ${
                    typeof payload === 'string' ? payload.slice(0, 300) : JSON.stringify(payload).slice(0, 300)
                }`
            );
        }

        return payload;
    }

    async authenticate() {
        if (this.mode === 'dashboards_proxy') {
            return this._request('_cluster/health', 'GET');
        }

        return this._request('/', 'GET');
    }

    async search(index, queryBody) {
        const searchIndex = index || this.index;
        return this._request(`${searchIndex}/_search`, 'POST', queryBody);
    }
}
