document.addEventListener('DOMContentLoaded', () => {
    const videoElement = document.getElementById('camera-feed');
    const loadingSpinner = document.getElementById('loading-spinner');
    const errorMessage = document.getElementById('camera-error');
    const retryBtn = document.getElementById('retry-btn');
    const statusIndicator = document.querySelector('.status-indicator');

    let currentStream = null;
    let isCameraOn = true;
    const toggleBtn = document.getElementById('toggle-camera-btn');

    async function startCamera() {
        try {
            // If already on, don't restart (unless retrying from error)
            if (currentStream && currentStream.active) return;

            errorMessage.classList.add('hidden');
            loadingSpinner.classList.remove('hidden');

            currentStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    facingMode: "user"
                },
                audio: false
            });

            videoElement.srcObject = currentStream;

            videoElement.onloadedmetadata = () => {
                loadingSpinner.classList.add('hidden');
                videoElement.play();
                statusIndicator.classList.add('active');
                updateToggleButtonState(true);
            };

        } catch (err) {
            console.error("Error accessing camera:", err);
            loadingSpinner.classList.add('hidden');
            errorMessage.classList.remove('hidden');
            statusIndicator.classList.remove('active');
            updateToggleButtonState(false);
        }
    }

    function stopCamera() {
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
            videoElement.srcObject = null;
            currentStream = null;
        }
        statusIndicator.classList.remove('active');
        updateToggleButtonState(false);
    }

    function updateToggleButtonState(isOn) {
        isCameraOn = isOn;
        if (isOn) {
            toggleBtn.classList.remove('off');
            toggleBtn.classList.add('active');
            toggleBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`;
        } else {
            toggleBtn.classList.remove('active');
            toggleBtn.classList.add('off');
            // Camera Off Icon (Slash)
            toggleBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M21 21l-2-2m-3.268-3.268L6 6"></path><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path></svg>`;
        }
    }

    toggleBtn.addEventListener('click', () => {
        if (isCameraOn) {
            stopCamera();
        } else {
            startCamera();
        }
    });

    // Initial start
    startCamera();

    // Retry button handler
    retryBtn.addEventListener('click', startCamera);

    // Stop stream when page is closed/hidden to save resources
    window.addEventListener('beforeunload', () => {
        stopCamera();
    });
});
