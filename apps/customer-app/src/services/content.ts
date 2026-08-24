import type { PromoBanner } from '@/constants/content';
import { appConfig } from '@/utils/app-config';
import { apiClient } from './api-client';

export type { PromoBanner } from '@/constants/content';

export interface GuideArticle {
  id: string;
  category: string;
  title: string;
  summary: string;
  readMinutes: number;
  authorName: string;
  companyName: string;
  likeCount: number;
  createdAt?: string;
}

export interface GuideLikeResult {
  liked: boolean;
  likeCount: number;
}

export async function fetchBanners(accessToken?: string | null): Promise<PromoBanner[]> {
  if (appConfig.allowDemoMode) {
    const { PROMO_BANNERS } = await import('@/constants/content');
    return PROMO_BANNERS.map((banner) => ({ ...banner }));
  }
  return apiClient.get<PromoBanner[]>(
    '/api/v1/content/banners',
    undefined,
    { authToken: accessToken, errorFallback: 'Could not load banners' },
  );
}

export async function fetchGuides(category: string | null, accessToken?: string | null): Promise<GuideArticle[]> {
  if (appConfig.allowDemoMode) {
    const { GUIDE_ARTICLES } = await import('@/constants/content');
    return GUIDE_ARTICLES.filter((g) => !category || g.category === category).map((g) => ({
      id: g.id,
      category: g.category,
      title: g.title,
      summary: g.summary,
      readMinutes: g.readMinutes,
      authorName: g.authorName,
      companyName: g.companyName,
      likeCount: g.likeCount,
    }));
  }
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  return apiClient.get<GuideArticle[]>(
    `/api/v1/content/guides${query}`,
    undefined,
    { authToken: accessToken, errorFallback: 'Could not load guides' },
  );
}

export async function toggleGuideLike(
  articleId: string,
  accessToken?: string | null,
): Promise<GuideLikeResult> {
  return apiClient.post<GuideLikeResult>(
    `/api/v1/content/guides/${articleId}/likes`,
    undefined,
    undefined,
    { authToken: accessToken, errorFallback: 'Could not update guide like' },
  );
}
