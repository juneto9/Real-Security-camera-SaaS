/**
 * RSC Store Screen - Mobile
 * Fetches live product data from API (same source as web store)
 * Native horizontal filter tabs by category
 * Progressive image loading with spinner
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, ScrollView,
  Image, ActivityIndicator, Linking, Platform, Dimensions, RefreshControl,
} from 'react-native';
import api from '../lib/api';

const { width: SW } = Dimensions.get('window');
const CARD_W = (SW - 36) / 2;

const CATEGORIES = ['All', 'Hardware', 'Apparel', 'Headwear', 'Accessories', 'Stickers'];

function ProductCard({ item }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const isBackorder = item.backorder || item.preorder;

  return (
    <View style={[s.card, { width: CARD_W }]}>
      {/* Image */}
      <View style={s.imgWrap}>
        {!loaded && !errored && (
          <View style={s.imgPlaceholder}>
            <ActivityIndicator color="#E02020" size="small" />
          </View>
        )}
        {!errored && item.image_url ? (
          <Image
            source={{ uri: item.image_url, cache: 'force-cache' }}
            style={[s.img, { opacity: loaded ? 1 : 0 }]}
            resizeMode="cover"
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            progressiveRenderingEnabled={true}
            fadeDuration={200}
          />
        ) : null}
        {errored && (
          <View style={s.imgPlaceholder}>
            <Text style={{ fontSize: 28 }}>📦</Text>
          </View>
        )}
        {/* Backorder badge */}
        {isBackorder && (
          <View style={s.backorderBadge}>
            <Text style={s.backorderText}>BACKORDER</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={s.info}>
        <Text style={s.name} numberOfLines={2}>{item.name}</Text>
        <View style={s.priceRow}>
          <View>
            <Text style={s.price}>${typeof item.price === 'number' ? item.price.toFixed(2) : item.price}</Text>
            {item.compare_at ? (
              <Text style={s.compareAt}>${item.compare_at.toFixed(2)}</Text>
            ) : null}
          </View>
          {isBackorder ? (
            <View style={s.reserveBtn}>
              <Text style={s.reserveText}>Reserve</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={s.buyBtn}
              onPress={() => Linking.openURL('https://realsecuritycamera.com/app?tab=store')}
            >
              <Text style={s.buyText}>Buy</Text>
            </TouchableOpacity>
          )}
        </View>
        {isBackorder && item.lead_time ? (
          <Text style={s.leadTime}>Ships in {item.lead_time}</Text>
        ) : null}
      </View>
    </View>
  );
}

export default function StoreScreen() {
  const [products, setProducts] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [activeTab, setActiveTab] = useState('All');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await api.get('/api/store/products');
      const data = res.data?.data || res.data || [];
      setProducts(data);
      setFiltered(data);
    } catch (e) {
      console.warn('[StoreScreen] fetch error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const selectTab = useCallback((cat) => {
    setActiveTab(cat);
    if (cat === 'All') {
      setFiltered(products);
    } else {
      setFiltered(products.filter(p => p.category?.toLowerCase() === cat.toLowerCase()));
    }
  }, [products]);

  const renderItem = useCallback(({ item }) => <ProductCard item={item} />, []);
  const keyExtractor = useCallback((item) => item.id, []);

  if (loading) {
    return (
      <View style={[s.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color="#E02020" size="large" />
        <Text style={{ color: '#555', marginTop: 12, fontSize: 13 }}>Loading store...</Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>RSC Store</Text>
        <Text style={s.sub}>Liberate Your Home · No Contracts</Text>
      </View>

      {/* Filter tabs — horizontal scroll */}
      <View style={s.tabBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabScroll}
        >
          {CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat}
              style={[s.tab, activeTab === cat && s.tabActive]}
              onPress={() => selectTab(cat)}
            >
              <Text style={[s.tabText, activeTab === cat && s.tabTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Product grid */}
      <FlatList
        data={filtered}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={2}
        columnWrapperStyle={s.row2}
        contentContainerStyle={s.list}
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={5}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchProducts(); }}
            tintColor="#E02020"
          />
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIcon}>📦</Text>
            <Text style={s.emptyText}>No products in this category</Text>
          </View>
        }
        ListFooterComponent={
          <TouchableOpacity
            style={s.fullStoreBtn}
            onPress={() => Linking.openURL('https://realsecuritycamera.com/app?tab=store')}
          >
            <Text style={s.fullStoreBtnText}>View Full Store →</Text>
          </TouchableOpacity>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },

  header: {
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '800' },
  sub:   { color: '#555', fontSize: 12, marginTop: 2 },

  tabBar: {
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
    backgroundColor: '#0a0a0a',
  },
  tabScroll: { paddingHorizontal: 12, paddingVertical: 10, gap: 8, flexDirection: 'row' },
  tab: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#1e1e1e',
    backgroundColor: '#111',
  },
  tabActive: { backgroundColor: '#E02020', borderColor: '#E02020' },
  tabText:       { color: '#666', fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: '#fff', fontSize: 12, fontWeight: '700' },

  list:  { padding: 12, paddingBottom: 40 },
  row2:  { justifyContent: 'space-between', marginBottom: 12 },

  card: {
    backgroundColor: '#111', borderRadius: 12,
    overflow: 'hidden', borderWidth: 1, borderColor: '#1e1e1e',
  },
  imgWrap: { width: '100%', height: CARD_W * 0.8, backgroundColor: '#0d0d0d' },
  img: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  imgPlaceholder: {
    position: 'absolute', top: 0, left: 0,
    width: '100%', height: '100%',
    alignItems: 'center', justifyContent: 'center',
  },
  backorderBadge: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: '#7a6000', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  backorderText: { color: '#ffd700', fontSize: 8, fontWeight: '800' },

  info: { padding: 10 },
  name: { color: '#fff', fontSize: 12, fontWeight: '700', marginBottom: 6, lineHeight: 16 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  price:     { color: '#E02020', fontSize: 14, fontWeight: '900' },
  compareAt: { color: '#444', fontSize: 10, textDecorationLine: 'line-through' },
  leadTime:  { color: '#7a6000', fontSize: 9, fontWeight: '700', marginTop: 4 },

  buyBtn: {
    backgroundColor: '#E02020', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  buyText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  reserveBtn: {
    backgroundColor: '#7a6000', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  reserveText: { color: '#ffd700', fontSize: 11, fontWeight: '800' },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 10 },
  emptyText: { color: '#444', fontSize: 14 },

  fullStoreBtn: {
    margin: 16, backgroundColor: '#E02020',
    borderRadius: 10, padding: 14, alignItems: 'center',
  },
  fullStoreBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
