// src/utils/recorder.ts
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

export function isVp9AlphaSupported() {
    return !!(window as any).MediaRecorder?.isTypeSupported?.("video/webm;codecs=vp9");
}

export function pickVp9Mime(): string | null {
    // 优先尝试VP9，然后是VP8，最后是默认WebM
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) return "video/webm;codecs=vp9";
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) return "video/webm;codecs=vp8";
    if (MediaRecorder.isTypeSupported("video/webm")) return "video/webm";
    return null;
}

export function createVp9AlphaRecorder(
    canvas: HTMLCanvasElement,
    fps = 60,
    kbps = 16000,
    options?: {
        autoStop?: boolean;
        onProgress?: (time: number) => void;
        transparent?: boolean;
        audioClips?: Array<{ id: string; start: number; duration: number; audioUrl: string }>;
        timelineLength?: number;
    }
) {
    let mr: MediaRecorder | null = null;
    let chunks: BlobPart[] = [];
    let ac: AudioContext | null = null;
    let cs: ConstantSourceNode | null = null;
    let stream: MediaStream | null = null;
    let recordingStartTime: number = 0;
    let progressInterval: number | null = null;
    let audioElements: Map<string, HTMLAudioElement> = new Map();
    let audioDestination: MediaStreamAudioDestinationNode | null = null;

    function makeStream(): MediaStream {
        // 强制设置canvas透明背景
        canvas.style.background = 'transparent';
        
        // 调试信息
        console.log("🔍 录制器调试信息:");
        console.log("- canvas style.background:", canvas.style.background);
        console.log("- canvas computed background:", window.getComputedStyle(canvas).background);
        console.log("- canvas width/height:", canvas.width, canvas.height);
        
        // 使用canvas.captureStream获取视频流，支持透明背景
        const s = canvas.captureStream(fps);
        console.log("[rec] captureStream fps=", fps, "tracks=", s.getTracks().map(t => t.kind));
        
        // 创建音频上下文和混合器
        try {
            ac = new AudioContext();
            audioDestination = ac.createMediaStreamDestination();
            
            // 如果有音频片段，创建音频轨道
            if (options?.audioClips && options.audioClips.length > 0) {
                console.log("[rec] 设置音频轨道，音频片段数:", options.audioClips.length);
                
                options.audioClips.forEach(clip => {
                    try {
                        const audio = new Audio(clip.audioUrl);
                        audio.preload = 'auto';
                        audio.volume = 0.8;
                        
                        // 创建音频源节点
                        const source = ac!.createMediaElementSource(audio);
                        source.connect(audioDestination!);
                        
                        // 存储音频元素引用
                        audioElements.set(clip.id, audio);
                        
                        console.log(`[rec] 音频轨道 ${clip.id} 已连接`);
                    } catch (error) {
                        console.warn(`[rec] 音频轨道 ${clip.id} 连接失败:`, error);
                    }
                });
                
                // 将混合后的音频添加到视频流
                const audioTrack = audioDestination.stream.getAudioTracks()[0];
                if (audioTrack) {
                    s.addTrack(audioTrack);
                    console.log("[rec] 混合音频轨道已添加到录制流");
                }
            } else {
                // 如果没有音频，添加静音轨道避免部分实现不产块
                cs = ac.createConstantSource();
                const g = ac.createGain();
                g.gain.value = 0; // 静音
                cs.connect(g).connect(audioDestination!);
                cs.start();
                const at = audioDestination!.stream.getAudioTracks()[0];
                if (at) s.addTrack(at);
                console.log("[rec] added silent audio track");
            }
        } catch (e) {
            console.warn("[rec] audio track setup failed:", e);
        }
        
        stream = s;
        return s;
    }

    function start() {
        const mime = pickVp9Mime();
        if (!mime) throw new Error("VP9/VP8 WebM not supported");
        
        const stream = makeStream();
        chunks = [];
        recordingStartTime = Date.now();
        
        // 创建MediaRecorder，支持透明度
        mr = new MediaRecorder(stream, {
            mimeType: mime,
            videoBitsPerSecond: kbps * 1000,
        });
        
        // 调试：检查MediaRecorder支持
        console.log("🔍 MediaRecorder 支持检查:");
        console.log("- mimeType:", mime);
        console.log("- isTypeSupported:", MediaRecorder.isTypeSupported(mime));
        console.log("- MediaRecorder options:", { mimeType: mime, videoBitsPerSecond: kbps * 1000 });
        
        mr.onerror = (e) => console.error("[rec] MediaRecorder error:", e);
        mr.ondataavailable = (e) => {
            if (e.data && e.data.size) {
                chunks.push(e.data);
            }
        };
        
        mr.onstart = () => {
            console.log("[rec] started", mime);
            
            // 启动进度回调
            if (options?.onProgress) {
                progressInterval = window.setInterval(() => {
                    const elapsed = (Date.now() - recordingStartTime) / 1000;
                    options.onProgress!(elapsed);
                }, 100);
            }
            
            // 按照时间线顺序启动音频播放
            if (options?.audioClips && options.audioClips.length > 0) {
                console.log("[rec] 启动音频按时间线顺序播放");
                
                // 按开始时间排序音频片段
                const sortedClips = [...options.audioClips].sort((a, b) => a.start - b.start);
                
                sortedClips.forEach((clip) => {
                    const audio = audioElements.get(clip.id);
                    if (audio) {
                        // 延迟播放，按照时间线上的开始时间
                        setTimeout(() => {
                            try {
                                audio.currentTime = 0;
                                audio.play().then(() => {
                                    console.log(`[rec] 音频 ${clip.id} 在 ${clip.start}s 开始播放，持续 ${clip.duration}s`);
                                }).catch(err => {
                                    console.warn(`[rec] 音频 ${clip.id} 播放失败:`, err);
                                });
                                
                                // 在片段结束后自动停止
                                setTimeout(() => {
                                    try {
                                        audio.pause();
                                        audio.currentTime = 0;
                                        console.log(`[rec] 音频 ${clip.id} 播放结束`);
                                    } catch (e) {
                                        console.warn(`[rec] 停止音频 ${clip.id} 失败:`, e);
                                    }
                                }, clip.duration * 1000);
                            } catch (e) {
                                console.warn(`[rec] 处理音频 ${clip.id} 失败:`, e);
                            }
                        }, clip.start * 1000);
                    }
                });
            }
        };
        
        mr.onstop = () => {
            console.log("[rec] stopped, chunks:", chunks.length);
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            
            // 停止所有音频播放
            audioElements.forEach(audio => {
                try {
                    audio.pause();
                    audio.currentTime = 0;
                } catch (e) {
                    console.warn("[rec] 停止音频失败:", e);
                }
            });
        };
        
        // 用 timeslice 让实现周期性产块，更稳
        mr.start(250); // 每 250ms 产出一块
    }

    function stop(): Promise<Blob> {
        return new Promise((resolve) => {
            if (!mr) return resolve(new Blob());
            
            // 先请求一次数据，确保最后一块吐出来
            try { mr.requestData(); } catch {}
            
            mr.onstop = () => {
                const blob = new Blob(chunks, { type: mr!.mimeType });
                cleanup();
                console.log("[rec] blob size:", blob.size);
                resolve(blob);
            };
            
            mr.stop();
        });
    }

    function cleanup() {
        try { cs?.stop(); } catch {}
        try { ac?.close(); } catch {}
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
        
        // 清理音频元素
        audioElements.forEach(audio => {
            try {
                audio.pause();
                audio.src = '';
            } catch (e) {
                console.warn("[rec] 清理音频元素失败:", e);
            }
        });
        audioElements.clear();
        
        mr = null; 
        cs = null; 
        ac = null;
        stream = null;
        audioDestination = null;
    }

    async function saveWebM(blob: Blob, defaultName = "export-alpha.webm") {
        const out = await save({ defaultPath: defaultName, filters: [{ name: "WebM", extensions: ["webm"] }] });
        if (!out) return;
        await writeFile(out, new Uint8Array(await blob.arrayBuffer()));
    }

    // 获取录制时长
    function getRecordingTime(): number {
        if (!recordingStartTime) return 0;
        return (Date.now() - recordingStartTime) / 1000;
    }

    // 检查是否正在录制
    function isRecording(): boolean {
        return mr?.state === "recording";
    }

    return { start, stop, cleanup, saveWebM, getRecordingTime, isRecording };
}

export function createModelFrameRecorder(
    canvas: HTMLCanvasElement,
    modelBounds: { x: number; y: number; width: number; height: number },
    fps = 60,
    kbps = 16000,
    options?: {
        autoStop?: boolean;
        onProgress?: (time: number) => void;
        transparent?: boolean;
        showFrame?: boolean; // 是否显示录制边框
    }
) {
    let mr: MediaRecorder | null = null;
    let chunks: BlobPart[] = [];
    let ac: AudioContext | null = null;
    let cs: ConstantSourceNode | null = null;
    let stream: MediaStream | null = null;
    let recordingStartTime: number = 0;
    let progressInterval: number | null = null;
    
    // 创建裁剪canvas
    const cropCanvas = document.createElement('canvas');
    const cropCtx = cropCanvas.getContext('2d')!;
    
    // 设置裁剪canvas尺寸
    cropCanvas.width = modelBounds.width;
    cropCanvas.height = modelBounds.height;
    
    // 边框显示元素
    let frameElement: HTMLDivElement | null = null;
    if (options?.showFrame) {
        frameElement = document.createElement('div');
        frameElement.style.position = 'absolute';
        frameElement.style.border = '2px solid #ff0000';
        frameElement.style.pointerEvents = 'none';
        frameElement.style.zIndex = '9999';
        frameElement.style.left = `${modelBounds.x}px`;
        frameElement.style.top = `${modelBounds.y}px`;
        frameElement.style.width = `${modelBounds.width}px`;
        frameElement.style.height = `${modelBounds.height}px`;
        document.body.appendChild(frameElement);
    }

    function makeStream(): MediaStream {
        // 强制设置canvas透明背景
        canvas.style.background = 'transparent';
        
        // 使用裁剪canvas获取视频流
        const s = cropCanvas.captureStream(fps);
        console.log("[rec] crop captureStream fps=", fps, "tracks=", s.getTracks().map(t => t.kind));
        
        // 添加静音音频轨道
        try {
            ac = new AudioContext();
            cs = ac.createConstantSource();
            const g = ac.createGain();
            g.gain.value = 0; // 静音
            const dest = ac.createMediaStreamDestination();
            cs.connect(g).connect(dest);
            cs.start();
            const at = dest.stream.getAudioTracks()[0];
            if (at) s.addTrack(at);
            console.log("[rec] added silent audio track");
        } catch (e) {
            console.warn("[rec] audio track add failed (ok to ignore):", e);
        }
        
        stream = s;
        return s;
    }

    function start() {
        const mime = pickVp9Mime();
        if (!mime) throw new Error("VP9/VP8 WebM not supported");
        
        const stream = makeStream();
        chunks = [];
        recordingStartTime = Date.now();
        
        // 创建MediaRecorder，支持透明度
        mr = new MediaRecorder(stream, {
            mimeType: mime,
            videoBitsPerSecond: kbps * 1000,
        });
        
        mr.onerror = (e) => console.error("[rec] MediaRecorder error:", e);
        mr.ondataavailable = (e) => {
            if (e.data && e.data.size) {
                chunks.push(e.data);
            }
        };
        
        mr.onstart = () => {
            console.log("[rec] started crop recording", mime);
            
            // 启动进度回调
            if (options?.onProgress) {
                progressInterval = window.setInterval(() => {
                    const elapsed = (Date.now() - recordingStartTime) / 1000;
                    options.onProgress!(elapsed);
                }, 100);
            }
            
            // 开始裁剪录制循环
            startCropLoop();
        };
        
        mr.onstop = () => {
            console.log("[rec] stopped, chunks:", chunks.length);
            if (progressInterval) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
            stopCropLoop();
        };
        
        mr.start(250); // 每 250ms 产出一块
    }

    function startCropLoop() {
        const cropLoop = () => {
            if (mr?.state === 'recording') {
                // 裁剪canvas内容到录制区域
                cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
                cropCtx.drawImage(
                    canvas,
                    modelBounds.x, modelBounds.y, modelBounds.width, modelBounds.height,
                    0, 0, cropCanvas.width, cropCanvas.height
                );
                requestAnimationFrame(cropLoop);
            }
        };
        requestAnimationFrame(cropLoop);
    }

    function stopCropLoop() {
        // 停止裁剪循环
    }

    function stop(): Promise<Blob> {
        return new Promise((resolve) => {
            if (!mr) return resolve(new Blob());
            
            // 先请求一次数据，确保最后一块吐出来
            try { mr.requestData(); } catch {}
            
            mr.onstop = () => {
                const blob = new Blob(chunks, { type: mr!.mimeType });
                cleanup();
                console.log("[rec] crop blob size:", blob.size);
                resolve(blob);
            };
            
            mr.stop();
        });
    }

    function cleanup() {
        try { cs?.stop(); } catch {}
        try { ac?.close(); } catch {}
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
        if (frameElement) {
            document.body.removeChild(frameElement);
            frameElement = null;
        }
        mr = null; 
        cs = null; 
        ac = null;
        stream = null;
    }

    async function saveWebM(blob: Blob, defaultName = "export-crop-alpha.webm") {
        const out = await save({ defaultPath: defaultName, filters: [{ name: "WebM", extensions: ["webm"] }] });
        if (!out) return;
        await writeFile(out, new Uint8Array(await blob.arrayBuffer()));
    }

    // 获取录制时长
    function getRecordingTime(): number {
        if (!recordingStartTime) return 0;
        return (Date.now() - recordingStartTime) / 1000;
    }

    // 检查是否正在录制
    function isRecording(): boolean {
        return mr?.state === "recording";
    }

    return { start, stop, cleanup, saveWebM, getRecordingTime, isRecording };
}
