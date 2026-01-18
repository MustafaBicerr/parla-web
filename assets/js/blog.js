// assets/js/blog.js

// --- AYARLAR ---
// Lütfen kendi Space ID ve Access Token bilgilerinizi buraya yapıştırın.
const SPACE_ID = 'ezeuhp869959';
const ACCESS_TOKEN = '1vxehLknGy9-W1MWstH5RQ0vErQkF8xfrCNRb-2ZRbc';

const client = contentful.createClient({
    space: SPACE_ID,
    accessToken: ACCESS_TOKEN
});

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const slug = urlParams.get('slug');

    // Hangi sayfada olduğumuza göre fonksiyon seçimi
    if (slug) {
        // Detay sayfası
        loadBlogPost(slug);
    } else if (document.getElementById('blog-container')) {
        // Liste sayfası
        loadBlogList();
    }
});

// --- BLOG LİSTESİ FONKSİYONU ---
function loadBlogList() {
    const container = document.getElementById('blog-container');
    if (!container) return; // Hata önleyici

    container.innerHTML = '<p style="text-align:center;">Yazılar yükleniyor...</p>';

    client.getEntries({
        content_type: 'pageBlogPost', // Senin şablonundaki ID
        order: '-fields.publishedDate' // Tarihe göre sırala (Yeniden eskiye)
    })
    .then((response) => {
        container.innerHTML = '';
        
        if (response.items.length === 0) {
            container.innerHTML = '<p>Henüz blog yazısı eklenmemiş.</p>';
            return;
        }

        response.items.forEach((item) => {
            const title = item.fields.title;
            const slug = item.fields.slug;
            
            // Görsel Kontrolü
            const image = item.fields.featuredImage 
                ? item.fields.featuredImage.fields.file.url 
                : 'https://via.placeholder.com/400x200?text=No+Image';
            
            // Tarih Formatlama
            const dateStr = item.fields.publishedDate;
            const date = dateStr ? new Date(dateStr).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
            
            // Özet
            const excerpt = item.fields.shortDescription || 'Yazıyı okumak için tıklayın...'; 

            const cardHTML = `
                <a href="blog-detail.html?slug=${slug}" class="blog-card">
                    <img src="${image}" alt="${title}" class="blog-image">
                    <div class="blog-content">
                        <span class="blog-date">${date}</span>
                        <h3 class="blog-title">${title}</h3>
                        <p class="blog-excerpt">${excerpt}</p>
                    </div>
                </a>
            `;
            container.innerHTML += cardHTML;
        });
    })
    .catch((err) => {
        console.error("Liste Hatası:", err);
        container.innerHTML = '<p>Yazılar yüklenirken bir hata oluştu.</p>';
    });
}

// --- BLOG DETAY FONKSİYONU ---
function loadBlogPost(slug) {
    const container = document.getElementById('blog-post-content');
    if (!container) return;

    client.getEntries({
        content_type: 'pageBlogPost',
        'fields.slug': slug
    })
    .then((response) => {
        if (response.items.length === 0) {
            container.innerHTML = '<h2>Yazı bulunamadı.</h2>';
            return;
        }

        const post = response.items[0];

        // SEO Bileşeni varsa verileri al
        if (post.fields.seoFields) {
            const seo = post.fields.seoFields.fields;
            
            // 1. Tarayıcı Sekme Başlığını Değiştir
            document.title = seo.pageTitle || post.fields.title; 
            
            // 2. Meta Açıklamasını Bul ve Değiştir
            let metaDesc = document.querySelector('meta[name="description"]');
            if (!metaDesc) {
                metaDesc = document.createElement('meta');
                metaDesc.name = "description";
                document.head.appendChild(metaDesc);
            }
            metaDesc.content = seo.description || post.fields.shortDescription || '';
        }

        const title = post.fields.title;
        const image = post.fields.featuredImage ? post.fields.featuredImage.fields.file.url : null;
        
        const dateStr = post.fields.publishedDate;
        const date = dateStr ? new Date(dateStr).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
        
        const rawRichText = post.fields.content; 

        // Rich Text içindeki görselleri işlemek için ayarlar
        const options = {
    renderNode: {
        // 1. Standart Resimler İçin (Zaten Vardı)
        'embedded-asset-block': (node) => {
            if (node.data.target && node.data.target.fields) {
                const url = node.data.target.fields.file.url;
                const alt = node.data.target.fields.title || 'Görsel';
                return `<img src="${url}" alt="${alt}" style="max-width:100%; height:auto; margin: 20px 0; border-radius: 8px;" />`;
            }
            return '';
        },
        // 2. YENİ EKLENECEK KISIM: Özel 'Rich Image' Bileşenleri İçin
        'embedded-entry-block': (node) => {
            // Eğer bu bir 'componentRichImage' ise
            if (node.data.target.sys.contentType.sys.id === 'componentRichImage') {
                const fields = node.data.target.fields;
                const imageUrl = fields.image.fields.file.url;
                const caption = fields.caption || ''; // Varsa resim altı yazısı
                
                return `
                    <figure style="margin: 30px 0;">
                        <img src="${imageUrl}" alt="${caption}" style="max-width:100%; height:auto; border-radius: 8px;">
                        ${caption ? `<figcaption style="text-align:center; color:#666; font-size:0.9em; margin-top:5px;">${caption}</figcaption>` : ''}
                    </figure>
                `;
            }
            return ''; // Başka bir bileşense boş geç
        }
    }
};
        
        // window.documentToHtmlString fonksiyonu blog-detail.html'deki script'ten geliyor
        let contentHTML = '';
        if (typeof window.documentToHtmlString === 'function') {
            contentHTML = window.documentToHtmlString(rawRichText, options);
        } else {
            console.error("Rich Text Renderer yüklenemedi!");
            contentHTML = "<p>İçerik yüklenirken teknik bir hata oluştu (Renderer hatası).</p>";
        }

        // HTML Elementlerine Basma
        const titleEl = document.getElementById('post-title');
        if(titleEl) titleEl.innerText = title;

        const dateEl = document.getElementById('post-date');
        if(dateEl) dateEl.innerText = date ? `Yayınlanma Tarihi: ${date}` : '';
        
        const imgEl = document.getElementById('post-hero-image');
        if (image && imgEl) {
            imgEl.src = image;
            imgEl.style.display = 'block';
        }

        const contentEl = document.getElementById('rich-text-area');
        if(contentEl) contentEl.innerHTML = contentHTML;
    })
    .catch((err) => {
        console.error("Detay Hatası:", err);
    });
}