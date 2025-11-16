document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('liveWall');
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get('id');

    async function fetchPhotos() {
        try {
            const url = eventId ? `${API_CONFIG.baseUrl}/photos/event/${encodeURIComponent(eventId)}` : `${API_CONFIG.baseUrl}/photos/recent?limit=60`;
            const res = await fetch(url);
            const photos = await res.json();
            render(photos);
        } catch (_) {
            // ignore
        }
    }

    function render(list) {
        grid.innerHTML = (list || []).map(p => `
            <img src="${p.url}" alt="photo"/>
        `).join('');
    }

    fetchPhotos();
    setInterval(fetchPhotos, 8000);
});


