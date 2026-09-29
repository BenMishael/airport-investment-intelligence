"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const QUESTION_MAX_LENGTH = 1000;

type RecognitionErrorCode = "not-allowed" | "service-not-allowed" | "aborted" | "no-speech" | string;

type RecognitionAlternativeLike = {
  transcript?: string;
};

type RecognitionResultLike = {
  isFinal: boolean;
  length?: number;
  0?: RecognitionAlternativeLike;
  item?: (index: number) => RecognitionAlternativeLike;
};

type RecognitionResultListLike = ArrayLike<RecognitionResultLike> & {
  item?: (index: number) => RecognitionResultLike;
};

type RecognitionEventLike = {
  resultIndex: number;
  results: RecognitionResultListLike;
};

type RecognitionErrorEventLike = {
  error: RecognitionErrorCode;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives?: number;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onaudiostart?: (() => void) | null;
  addEventListener?: (type: string, listener: (event: RecognitionEventLike) => void) => void;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export type DictationError = "unsupported" | "denied" | "failed" | "empty" | "network" | "ready" | "";

export function joinDictation(base: string, spoken: string): string {
  return [base.trim(), spoken.trim()].filter(Boolean).join(" ").slice(0, QUESTION_MAX_LENGTH);
}

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
}

function recognitionLanguage(): string {
  const locale = typeof navigator !== "undefined" ? navigator.language : "";
  if (!locale) return "en-US";
  const lower = locale.toLowerCase();
  if (lower === "en-gb") return "en-GB";
  if (lower.startsWith("en")) return "en-US";
  return "en-US";
}

function resultAt(results: RecognitionResultListLike, index: number): RecognitionResultLike | undefined {
  return results[index] ?? results.item?.(index);
}

function transcriptOf(result: RecognitionResultLike | undefined): string {
  if (!result) return "";
  return (result[0] ?? result.item?.(0))?.transcript?.trim() ?? "";
}

export function transcriptFromResults(event: RecognitionEventLike): { spoken: string; isFinal: boolean } {
  let spoken = "";
  let sawInterim = false;
  for (let index = 0; index < event.results.length; index += 1) {
    const result = resultAt(event.results, index);
    const piece = transcriptOf(result);
    if (!piece) continue;
    spoken = spoken ? `${spoken} ${piece}` : piece;
    if (result && !result.isFinal) sawInterim = true;
  }
  return { spoken, isFinal: Boolean(spoken) && !sawInterim };
}

function isPermissionDenied(error: unknown): boolean {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  return name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError";
}

export function useSpeechDictation(onTranscript: (spoken: string, isFinal: boolean) => void) {
  const [supported] = useState(() => Boolean(getSpeechRecognitionConstructor()));
  const [listening, setListening] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<DictationError>(supported ? "" : "unsupported");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListenRef = useRef(false);
  const startIdRef = useRef(0);
  const lastSpokenRef = useRef("");
  const heardAudioRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const haltRecognition = useCallback(() => {
    wantListenRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setListening(false);
    try {
      recognition?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const promptMicrophone = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("denied");
      return;
    }
    setRequesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setRequesting(false);
      setError("ready");
    } catch (caught) {
      setRequesting(false);
      setError(isPermissionDenied(caught) ? "denied" : "failed");
    }
  }, []);

  const beginRecognition = useCallback(
    (Recognition: SpeechRecognitionConstructor, startId: number) => {
      if (startId !== startIdRef.current || !wantListenRef.current) return;
      const recognition = new Recognition();
      recognition.lang = recognitionLanguage();
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;
      const applyTranscript = (event: RecognitionEventLike) => {
        const { spoken } = transcriptFromResults(event);
        if (!spoken) return;
        lastSpokenRef.current = spoken;
        onTranscriptRef.current(spoken, false);
      };
      recognition.onresult = applyTranscript;
      recognition.addEventListener?.("result", applyTranscript);
      recognition.onaudiostart = () => {
        heardAudioRef.current = true;
      };
      recognition.onerror = (event) => {
        if (event.error === "no-speech" || event.error === "aborted") return;
        wantListenRef.current = false;
        setListening(false);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          void promptMicrophone();
          return;
        }
        if (event.error === "network") setError("network");
        else setError("failed");
      };
      recognition.onend = () => {
        if (wantListenRef.current && recognitionRef.current === recognition) {
          if (lastSpokenRef.current) {
            onTranscriptRef.current(lastSpokenRef.current, true);
            lastSpokenRef.current = "";
          }
          try {
            recognition.start();
          } catch {
            /* already started */
          }
          return;
        }
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setListening(false);
      };
      recognitionRef.current = recognition;
      setListening(true);
      try {
        recognition.start();
      } catch {
        wantListenRef.current = false;
        recognitionRef.current = null;
        setListening(false);
        setError("failed");
      }
    },
    [promptMicrophone],
  );

  const stop = useCallback(() => {
    const heard = lastSpokenRef.current;
    const wasListening = wantListenRef.current || Boolean(recognitionRef.current);
    startIdRef.current += 1;
    setRequesting(false);
    if (heard) {
      onTranscriptRef.current(heard, true);
      lastSpokenRef.current = "";
    } else if (wasListening && !heardAudioRef.current) {
      setError("empty");
    } else if (wasListening) {
      setError("empty");
    }
    haltRecognition();
  }, [haltRecognition]);

  const start = useCallback(() => {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setError("unsupported");
      return;
    }
    const startId = ++startIdRef.current;
    haltRecognition();
    lastSpokenRef.current = "";
    heardAudioRef.current = false;
    setError("");
    wantListenRef.current = true;
    beginRecognition(Recognition, startId);
  }, [beginRecognition, haltRecognition]);

  useEffect(
    () => () => {
      startIdRef.current += 1;
      wantListenRef.current = false;
      try {
        recognitionRef.current?.stop();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
    },
    [],
  );

  return { supported, listening, requesting, error, start, stop };
}
