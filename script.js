document.addEventListener('DOMContentLoaded', () => {
    const videoElement = document.getElementById('camera-feed');
    const loadingSpinner = document.getElementById('loading-spinner');
    const errorMessage = document.getElementById('camera-error');
    const retryBtn = document.getElementById('retry-btn');
    const statusIndicator = document.querySelector('.status-indicator');
    const toggleBtn = document.getElementById('toggle-camera-btn');
    const switchBtn = document.getElementById('switch-camera-btn');

    let currentStream = null;
    let isCameraOn = true;
    let currentFacingMode = 'user';
    let videoDevices = [];
    let currentDeviceIndex = 0;

    async function getVideoDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            videoDevices = devices.filter(device => device.kind === 'videoinput');
            switchBtn.style.display = 'flex';
        } catch (err) {
            console.error("Error enumerating devices:", err);
        }
    }

    async function startCamera(deviceId = null) {
        try {
            if (currentStream) {
                currentStream.getTracks().forEach(track => track.stop());
            }

            errorMessage.classList.add('hidden');
            loadingSpinner.classList.remove('hidden');

            const constraints = {
                video: {
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            };

            if (deviceId) {
                constraints.video.deviceId = { exact: deviceId };
            } else {
                constraints.video.facingMode = currentFacingMode;
            }

            currentStream = await navigator.mediaDevices.getUserMedia(constraints);
            videoElement.srcObject = currentStream;

            videoElement.style.transform = currentFacingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';

            videoElement.onloadedmetadata = () => {
                loadingSpinner.classList.add('hidden');
                videoElement.play();
                statusIndicator.classList.add('active');
                updateToggleButtonState(true);
                getVideoDevices();
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
            toggleBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M21 21l-2-2m-3.268-3.268L6 6"></path><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path></svg>`;
        }
    }

    async function switchCamera() {
        if (videoDevices.length < 2) {
            alert("No other camera detected.");
            return;
        }

        currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

        if (videoDevices.length > 0) {
            currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
            await startCamera(videoDevices[currentDeviceIndex].deviceId);

            const label = videoDevices[currentDeviceIndex].label.toLowerCase();
            if (label.includes('back') || label.includes('environment')) {
                currentFacingMode = 'environment';
                videoElement.style.transform = 'scaleX(1)';
            } else {
                currentFacingMode = 'user';
                videoElement.style.transform = 'scaleX(-1)';
            }
        } else {
            await startCamera();
        }
    }

    // Event listeners
    toggleBtn.addEventListener('click', () => {
        if (isCameraOn) {
            stopCamera();
        } else {
            startCamera();
        }
    });

    switchBtn.addEventListener('click', switchCamera);
    retryBtn.addEventListener('click', startCamera);

    window.addEventListener('beforeunload', () => {
        stopCamera();
    });

    // Initial setup
    getVideoDevices().then(() => {
        startCamera();
    });
});
