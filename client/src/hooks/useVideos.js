/**
 * useVideos — Custom React hook
 *
 * Tries to load videos from the Express backend API (/api/videos).
 * If the server is unavailable or returns an error, it automatically
 * falls back to the local mockData so the UI always has something to show.
 *
 * Returns:
 *   { videos, loading, error, usingFallback, refetch }
 *
 * Usage:
 *   const { videos, loading, error, usingFallback } = useVideos();
 */

import { useState, useEffect, useCallback } from 'react';
import { MOCK_VIDEOS } from '../data/mockData';

export function useVideos() {
  const [videos, setVideos]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [usingFallback, setUsingFallback] = useState(false);

  const fetchVideos = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // AbortController lets us cancel the fetch if it takes too long (3 seconds).
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 3000);

      const response = await fetch('/api/videos', {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Server responded with HTTP ${response.status}`);
      }

      const data = await response.json();
      setVideos(data.videos || []);
      setUsingFallback(false);
    } catch (err) {
      // If the server is down (AbortError = timeout, TypeError = network error)
      // or returned an HTTP error, silently use local data.
      console.warn('[useVideos] API unavailable, using local mock data:', err.message);
      setVideos(MOCK_VIDEOS);
      setUsingFallback(true);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  return { videos, loading, error, usingFallback, refetch: fetchVideos };
}

/**
 * useVideoById — Fetch a single video from the API.
 *
 * Usage:
 *   const { video, recommendations, loading } = useVideoById('vid-001');
 */
export function useVideoById(id) {
  const [video, setVideo]                     = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState(null);
  const [usingFallback, setUsingFallback]     = useState(false);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`/api/videos/${id}`, {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Server responded with HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!cancelled) {
          setVideo(data.video);
          setRecommendations(data.recommendations || []);
          setUsingFallback(false);
        }
      } catch (err) {
        console.warn('[useVideoById] API unavailable, using mock data:', err.message);
        if (!cancelled) {
          // Fallback: find in local data
          const found = MOCK_VIDEOS.find(v => v.id === id) || null;
          setVideo(found);
          setRecommendations(
            MOCK_VIDEOS.filter(v => v.id !== id && v.category === found?.category).slice(0, 10)
          );
          setUsingFallback(true);
          setError(err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  return { video, recommendations, loading, error, usingFallback };
}
