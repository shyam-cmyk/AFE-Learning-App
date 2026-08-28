import { useRef, useState, useCallback } from "react";

export function useStreamingSTT() {
  const [isRecording, setIsRecording] = useState(false);

  const isRecordingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || audioContextRef.current) return;
    if (!window.electronAPI?.stt) {
      console.warn("[STT] electronAPI.stt not available (not in Electron?)");
      return;
    }

    console.log("[STT] Starting recording...");

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log("[STT] getUserMedia OK");
      } catch (mediaErr) {
        const e = mediaErr as DOMException;
        console.error("[STT] getUserMedia failed:", e?.name, e?.message);
        throw mediaErr;
      }

      const audioContext = new AudioContext();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      console.log("[STT] AudioContext state:", audioContext.state);

      const source = audioContext.createMediaStreamSource(stream);

      // Root-relative in dev (http); same-dir in prod (file://) so worklet is found
      const workletUrl =
        window.location.protocol === "file:"
          ? new URL("stt-worklet.js", window.location.href).href
          : new URL("/stt-worklet.js", window.location.origin).href;
      try {
        await audioContext.audioWorklet.addModule(workletUrl);
        console.log("[STT] Worklet loaded:", workletUrl);
      } catch (workletErr) {
        const e = workletErr as Error;
        console.error("[STT] Worklet load failed:", workletUrl, e?.message);
        throw workletErr;
      }

      const workletNode = new AudioWorkletNode(audioContext, "stt-processor", {
        processorOptions: { sampleRate: audioContext.sampleRate },
      });

      workletNode.port.onmessage = (event) => {
        if (!isRecordingRef.current || !window.electronAPI?.stt) return;
        try {
          // Handle typed messages from updated worklet
          const data = event.data;
          if (data && data.type === "audio-data" && data.buffer) {
            window.electronAPI.stt.sendChunk(data.buffer);
          } else if (data instanceof ArrayBuffer) {
            // Backward compatibility with old worklet format
            window.electronAPI.stt.sendChunk(data);
          }
        } catch (err) {
          console.error("[STT] Error sending chunk:", err);
        }
      };

      source.connect(workletNode);
      workletNode.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      mediaStreamRef.current = stream;
      workletNodeRef.current = workletNode;

      isRecordingRef.current = true;
      setIsRecording(true);

      window.electronAPI.stt.start();
    } catch (error) {
      const isAbort =
        error instanceof DOMException && error.name === "AbortError";
      if (isAbort) {
        console.log("[STT] Recording start cancelled (mic denied or aborted).");
      } else {
        console.error("[STT] Error starting recording:", error);
      }
      isRecordingRef.current = false;
      // We only call stt.start() after setup succeeds, so no need to stop here
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;

    isRecordingRef.current = false;

    console.log("[STT] Stopping recording...");

    try {
      workletNodeRef.current?.disconnect();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());

      if (audioContextRef.current?.state !== "closed") {
        await audioContextRef.current?.close();
      }

      if (window.electronAPI?.stt) {
        window.electronAPI.stt.stop();
      }
    } catch (err) {
      console.error("[STT] Stop error:", err);
    }

    audioContextRef.current = null;
    mediaStreamRef.current = null;
    workletNodeRef.current = null;

    setIsRecording(false);
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
  };
}
