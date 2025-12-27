/**
 * Announcements Fetcher for Parla BT
 * Fetches data from Google Sheets CSV and renders cards.
 */

// REPLACE THIS URL with your actual Google Sheet CSV link
// File -> Share -> Publish to web -> CSV
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRYE8hj4IrjG-AffS6Tmzjc-pBGlxs9Y0qCq884ujBB8aUHaTq3lcJd07hjGCQk8RSHglGmuKtaoA9b/pub?gid=603337338&single=true&output=csv";

let allAnnouncementsData = [];
let isExpanded = false;

document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('announcements-grid');
    const toggleBtn = document.getElementById('announcement-toggle-btn');

    if (grid) {
        fetchAnnouncements(grid);
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            isExpanded = !isExpanded;
            renderAnnouncements(null, grid); // Re-render with new state

            // Scroll back to the beginning of the announcements section
            const section = document.getElementById('announcements');
            if (section) {
                section.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    // Resize listener to adjust view when switching between desktop/mobile
    window.addEventListener('resize', () => {
        if (!isExpanded && grid) {
            renderAnnouncements(null, grid);
        }
    });
});

async function fetchAnnouncements(container) {
    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        
        if (!response.ok) {
            // If URL is invalid (placeholder), show demo data
            console.warn("Could not fetch CSV, rendering demo data.");
            allAnnouncementsData = getDemoData();
            renderAnnouncements(allAnnouncementsData, container);
            return;
        }

        const csvText = await response.text();
        const data = parseCSV(csvText);
        
        if (data.length === 0) {
            allAnnouncementsData = getDemoData();
        } else {
            allAnnouncementsData = data;
        }
        renderAnnouncements(allAnnouncementsData, container);

    } catch (error) {
        console.error("Error loading announcements:", error);
        // Fallback to demo data if fetch fails
        allAnnouncementsData = getDemoData();
        renderAnnouncements(allAnnouncementsData, container);
    }
}

function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    // Normalize line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        if (char === '"') {
            if (inQuotes && text[i + 1] === '"') {
                currentField += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentField.trim());
            currentField = '';
        } else if (char === '\n' && !inQuotes) {
            currentRow.push(currentField.trim());
            if (currentRow.length > 0) rows.push(currentRow);
            currentRow = [];
            currentField = '';
        } else {
            currentField += char;
        }
    }
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
    }

    // Headers: Title, Description, Date, ImageURL
    if (rows.length < 2) return [];

    const headers = rows[0].map(h => h.toLowerCase().replace(/\s/g, ''));
    const result = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length === 0) continue;
        
        const obj = {};
        headers.forEach((h, idx) => {
            obj[h] = row[idx] || '';
        });
        result.push(obj);
    }
    return result;
}

function convertDriveLink(url) {
    if (!url) return '';
    
    // 1. ID'yi yakalamak için daha kapsamlı Regex (hem /d/ hem de id= formatını yakalar)
    let id = '';
    const parts = url.match(/[-\w]{25,}/); 
    if (parts && parts.length > 0) {
        id = parts[0];
    }

    if (id) {
        // ESKİ YÖNTEM (Artık çalışmıyor): 
        // return `https://drive.google.com/uc?export=view&id=${id}`;
        
        // YENİ VE GÜVENLİ YÖNTEM (Thumbnail API):
        // sz=w1000 parametresi görselin genişliğinin 1000px olmasını sağlar (kalite bozulmaz)
        return `https://drive.google.com/thumbnail?id=${id}&sz=w1000`;
    }
    
    return url;
}

function renderAnnouncements(data, container) {
    // Use stored data if not provided
    const sourceData = data || allAnnouncementsData;
    
    // Determine limit based on screen size and expansion state
    const isDesktop = window.innerWidth > 768;
    const defaultLimit = isDesktop ? 6 : 3; // Desktop: 2 rows (approx 6), Mobile: 3 rows (3 items)
    const limit = isExpanded ? sourceData.length : defaultLimit;

    const visibleData = sourceData.slice(0, limit);
    
    // Handle Button Visibility & Text
    const btnContainer = document.getElementById('announcements-btn-container');
    const toggleBtn = document.getElementById('announcement-toggle-btn');
    
    if (btnContainer && toggleBtn) {
        btnContainer.style.display = sourceData.length > defaultLimit ? 'block' : 'none';
        updateButtonText(toggleBtn, isExpanded ? 'home.announcements.btn_hide' : 'home.announcements.btn_show_all');
    }

    container.innerHTML = '';
    visibleData.forEach((item, index) => {
        const title = item.title || item.baslik || 'Başlık';
        const desc = item.description || item.aciklama || item.desc || '';
        const date = item.date || item.tarih || '';
        const rawImg = item.imageurl || item.image || item.gorsel || '';
        const imgUrl = convertDriveLink(rawImg) || 'https://placehold.co/600x400/eee/999?text=Parla+BT';

        const cardHTML = `
            <div class="announcement-card anim-block" data-animate="true" data-anim-type="fade-up" style="transition-delay: ${index * 0.1}s">
                <div class="announcement-image">
                    <img src="${imgUrl}" alt="${title}" loading="lazy" onerror="this.src='https://placehold.co/600x400/eee/999?text=No+Image'">
                </div>
                <div class="announcement-content">
                    <span class="announcement-date">${date}</span>
                    <h3>${title}</h3>
                    <p>${desc}</p>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', cardHTML);
    });
}

function updateButtonText(btn, key) {
    btn.setAttribute('data-i18n', key);
    // Try to update text immediately if i18n is loaded
    if (window.__i18n && window.__i18n.t) {
        const val = key.split('.').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : null, window.__i18n.t);
        if (val) btn.innerText = val;
    }
}

function getDemoData() {
    return [
        { title: "Yeni SAP S/4HANA Projemiz", description: "Global bir lojistik firması için yürüttüğümüz dönüşüm projesi başarıyla tamamlandı.", date: "15 Mayıs 2025", imageurl: "" },
        { title: "Parla Akademi Kayıtları", description: "Yeni mezunlara özel ABAP ve FI modül eğitimlerimiz başlıyor.", date: "01 Haziran 2025", imageurl: "" },
        { title: "E-Dönüşüm Güncellemesi", description: "GİB tarafından yayınlanan son tebliğe uygun sistem güncellemelerimiz hazırdır.", date: "20 Haziran 2025", imageurl: "" }
    ];
}