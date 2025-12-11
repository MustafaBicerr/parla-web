function initChatWidget() {
    // Prevent multiple initializations
    if (document.getElementById('fab-container')) return;

    // --- Configuration ---
    const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxe2v7-LXZBon0Hi36K96DXo0MOrNZ6MDRZ5Jv5t-6aCrKNcvUtF-OyPDvnGp0HhsI/exec";
    const WHATSAPP_NUMBER = "905352265408"; // Using the number from your contact info
    const PHONE_NUMBER = "+905352265408";
    const WHATSAPP_TEXT = "SAP+ile+ilgili+bilgi+almak+istiyorum";

    const widgetHTML = `
        <div class="chat-widget" id="chat-widget">
            <div class="chat-widget-header">
                <h3>Parla BT Asistanı</h3>
                <button class="chat-widget-close-btn" id="chat-close-btn" title="Kapat">&times;</button>
            </div>
            <div class="chat-widget-body" id="chat-body">
                <div class="chat-message bot">Merhaba! Size nasıl yardımcı olabilirim?</div>
            </div>
            <div class="chat-widget-footer">
                <form class="chat-form" id="chat-form">
                    <input type="text" class="chat-input" id="chat-input" placeholder="Mesajınızı yazın..." autocomplete="off" required>
                    <button type="submit" class="chat-send-btn" title="Gönder">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </form>
            </div>
        </div>

        <div class="fab-container" id="fab-container">
            <div class="fab-chatbot-wrapper">
                <div id="chatbot-fab" class="fab-item fab-chatbot" title="Parla BT Asistanı">
                    <i class="fas fa-comment-dots"></i>
                </div>
                <!-- Thought Bubble -->
                <div class="fab-thought-bubble">
                    <div class="fab-badge">7/24 Aktif Parla AI</div>
                    <div class="fab-thought-dots">
                        <span class="dot"></span>
                        <span class="dot"></span>
                        <span class="dot"></span>
                    </div>
                </div>
            </div>
            <a href="https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_TEXT}" target="_blank" class="fab-item fab-whatsapp" title="WhatsApp ile Ulaşın">
                <i class="fab fa-whatsapp"></i>
            </a>
            <a href="tel:${PHONE_NUMBER}" class="fab-item fab-phone" title="Bizi Arayın">
                <i class="fas fa-phone"></i>
            </a>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', widgetHTML);

    // Get references to elements
    const chatWidget = document.getElementById('chat-widget');
    const chatbotFab = document.getElementById('chatbot-fab');
    const closeBtn = document.getElementById('chat-close-btn');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatBody = document.getElementById('chat-body');

    // --- Event Listeners ---

    // Toggle chat widget visibility
    const toggleChat = () => {
        chatWidget.classList.toggle('visible');
        if (chatWidget.classList.contains('visible')) {
            chatInput.focus();
        }
    };

    chatbotFab.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);

    // Handle form submission
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (!message) return;

        appendMessage(message, 'user');
        chatInput.value = '';
        showTypingIndicator();
        
        sendToBot(message);
    });

    // --- Helper Functions ---

    function appendMessage(text, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${type}`;
        messageDiv.textContent = text;
        chatBody.appendChild(messageDiv);
        // Scroll to the bottom
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function showTypingIndicator() {
        // Remove existing indicator if any
        const existingIndicator = chatBody.querySelector('.typing-indicator');
        if (existingIndicator) existingIndicator.remove();

        const typingDiv = document.createElement('div');
        typingDiv.className = 'chat-message typing-indicator';
        typingDiv.innerHTML = '<span></span><span></span><span></span>';
        chatBody.appendChild(typingDiv);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function hideTypingIndicator() {
        const typingIndicator = chatBody.querySelector('.typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    async function sendToBot(message) {
        const payload = {
            type: 'chat',
            message: message
        };

        try {
            const response = await fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(payload),
            });

            let replyText = 'Üzgünüm, bir sorun oluştu. Lütfen daha sonra tekrar deneyin.';
            try {
                // Google Script'ten gelen cevabın { "reply": "..." } formatında olduğu varsayılıyor.
                const result = await response.json();
                if (result && result.reply) {
                    replyText = result.reply;
                }
            } catch (jsonError) {
                console.error("Google Script response was not valid JSON:", jsonError);
                replyText = 'Asistan şu anda yanıt veremiyor. Lütfen daha sonra tekrar deneyin.';
            }
            
            hideTypingIndicator();
            appendMessage(replyText, 'bot');

        } catch (error) {
            console.error('Chatbot fetch error:', error);
            hideTypingIndicator();
            appendMessage('Bağlantı hatası. Lütfen internet bağlantınızı kontrol edin.', 'bot');
        }
    }
}

// Expose the function to be called from main.js
window.initChatWidget = initChatWidget;