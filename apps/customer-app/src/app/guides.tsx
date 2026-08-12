import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/app-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppCard } from '@/components/ui/app-card';
import { ScreenHeader } from '@/components/ui/screen-header';
import { GUIDE_CATEGORIES, type GuideCategory } from '@/constants/content';
import { BottomTabInset, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/i18n';
import { fetchGuides, toggleGuideLike, type GuideArticle } from '@/services/content';

export default function GuidesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { session } = useAuth();
  const [category, setCategory] = useState<GuideCategory>('puppy-kitten');
  const [articles, setArticles] = useState<GuideArticle[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void fetchGuides(category, session?.access_token)
      .then(setArticles)
      .catch(() => setArticles([]));
  }, [category, session?.access_token]);

  const likeArticle = async (articleId: string) => {
    if (!session?.access_token) {
      router.push('/login' as never);
      return;
    }

    setBusyId(articleId);
    try {
      const result = await toggleGuideLike(articleId, session.access_token);
      setArticles((current) => current.map((article) => (
        article.id === articleId ? { ...article, likeCount: result.likeCount } : article
      )));
      setLikedIds((current) => {
        const next = new Set(current);
        if (result.liked) next.add(articleId);
        else next.delete(articleId);
        return next;
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScreenHeader
          title={t('guides.title')}
          subtitle={t('guides.subtitle')}
          trailing={
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('guides.goBack')}>
              <ThemedText style={{ color: theme.primary, fontWeight: '800' }}>{t('common.back')}</ThemedText>
            </Pressable>
          }
        />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingBottom: BottomTabInset + Spacing.six }]}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
            {GUIDE_CATEGORIES.map((item) => {
              const selected = item.id === category;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setCategory(item.id)}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor: selected ? theme.primary : theme.backgroundElement,
                      borderColor: theme.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t(`guides.categories.${item.id}.label`)}
                >
                  <ThemedText style={{ color: selected ? '#FFFFFF' : theme.text, fontWeight: '800' }}>
                    {t(`guides.categories.${item.id}.label`)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>

          <ThemedText type="small" themeColor="textSecondary">
            {t(`guides.categories.${category}.description`)}
          </ThemedText>

          {articles.map((article) => {
            const liked = likedIds.has(article.id);
            return (
              <AppCard key={article.id} style={styles.articleCard}>
                <View style={styles.articleRow}>
                  <View style={[styles.articleIcon, { backgroundColor: theme.primarySoft }]}>
                    <AppIcon name="shield" color={theme.primary} size={20} />
                  </View>
                  <View style={styles.articleCopy}>
                    <ThemedText style={styles.articleTitle}>{article.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{article.summary}</ThemedText>
                    <View style={styles.articleMetaRow}>
                      <ThemedText type="small" style={{ color: theme.accent, fontWeight: '700' }}>
                        {t('common.minRead', { minutes: article.readMinutes })}
                      </ThemedText>
                      <Pressable
                        onPress={() => void likeArticle(article.id)}
                        disabled={busyId === article.id}
                        style={[
                          styles.likeButton,
                          { backgroundColor: liked ? theme.primarySoft : theme.muted },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`${article.likeCount} likes`}
                      >
                        <AppIcon name="heart" color={liked ? theme.primary : theme.textSecondary} size={15} />
                        <ThemedText style={[styles.likeCount, { color: liked ? theme.primary : theme.textSecondary }]}>
                          {article.likeCount}
                        </ThemedText>
                      </Pressable>
                    </View>
                    <ThemedText style={[styles.byline, { color: theme.textSecondary }]}>
                      Written by {article.authorName} · {article.companyName}
                    </ThemedText>
                  </View>
                </View>
              </AppCard>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  categories: { gap: Spacing.two },
  categoryChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  articleCard: { gap: Spacing.two },
  articleRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  articleIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  articleCopy: { flex: 1, gap: 5 },
  articleTitle: { fontWeight: '900' },
  articleMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  likeButton: { minHeight: 32, borderRadius: 999, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  likeCount: { fontSize: 12, fontWeight: '800' },
  byline: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
});
