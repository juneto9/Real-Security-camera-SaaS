/**
 * RSC Store Screen - Mobile
 * Fast-loading product images: low-res placeholder first, full image lazy loads behind it.
 * Images served from DO Spaces CDN with Cache-Control headers.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  Image, ActivityIndicator, Linking, Platform, Dimensions,
} from 'react-native';

const CDN = 'https://real-security-camera-recordings.nyc3.cdn.digitaloceanspaces.com/products';
const { width: SW } = Dimensions.get('window');
const CARD_W = (SW - 36) / 2; // 2 columns with padding

// Products with CDN image URLs
const PRODUCTS = [
  { id: 'liberation-kit',        name: 'Liberation Kit',            price: '$19.99', tag: 'BEST VALUE',   tagColor: '#22c55e', img: CDN + '/Liberation_Kit.png' },
  { id: 'liberation-single',     name: 'Liberation Pack',           price: '$4.99',  tag: null,           tagColor: null,      img: CDN + '/Liberation-Packs.png' },
  { id: 'liberation-credits-3',  name: '3-Camera Pack',             price: '$9.99',  tag: 'SAVE 33%',     tagColor: '#ffd700', img: CDN + '/Liberation-Packs.png' },
  { id: 'property-liberation',   name: 'Whole Property Pack',       price: '$49.99', tag: 'WHOLE HOME',   tagColor: '#00aaff', img: CDN + '/Liberation-Packs.png' },
  { id: 'analog-adapter-single', name: 'BNC WiFi Adapter',          price: '$34.99', tag: 'CUT THE COAX', tagColor: '#E02020', img: CDN + '/single-bnc-coax.png' },
  { id: 'analog-adapter-4ch',    name: 'BNC Hub 4-Channel',         price: '$99.99', tag: 'MOST POPULAR', tagColor: '#ffd700', img: CDN + '/4port-bnc-hub.png' },
  { id: 'analog-adapter-8ch',    name: 'BNC Bundle 8-Channel',      price: '$179.99',tag: 'BUSINESS',     tagColor: '#ff6600', img: CDN + '/8port-bnc-hub.png' },
  { id: 'cam-budget',            name: 'RSC Indoor Cam 1080p',      price: '$24.99', tag: 'BEST ENTRY',   tagColor: '#22c55e', img: CDN + '/1080p-cam.png' },
  { id: 'cam-reolink-e1',        name: 'RSC/ADC-Reolink 5MP',       price: '$49.99', tag: null,           tagColor: null,      img: CDN + '/5mp-cam.png' },
  { id: 'cam-reolink-4k',        name: 'RSC/ADC-Reolink 4K Pro',    price: '$89.99', tag: 'TOP OF LINE',  tagColor: '#00aaff', img: CDN + '/4k-cam.png' },
  { id: 'tshirt-liberated',      name: '"Liberated" Tee — Unisex',  price: '$24.99', tag: null,           tagColor: null,      img: CDN + '/red-premium-unisex.png' },
  { id: 'hoodie',                name: 'RSC Tactical Hoodie',        price: '$54.99', tag: 'BEST SELLER',  tagColor: '#E02020', img: CDN + '/black-premium-pullover-hoodie-flat.png' },
  { id: 'hat-red',               name: 'Liberation Cap',             price: '$29.99', tag: null,           tagColor: null,      img: CDN + '/Richardson-112-snapback-trucker.png' },
  { id: 'stickers',              name: 'Sticker Pack (5)',           price: '$9.99',  tag: 'FAN FAV',      tagColor: '#22c55e', img: CDN + '/stickers.png' },
  { id: 'mug',                   name: '"Liberated" Mug',            price: '$17.99', tag: null,           tagColor: null,      img: CDN + '/coffee-mugs.png' },
  { id: 'tote-bag',              name: 'Liberation Tote',            price: '$16.99', tag: null,           tagColor: null,      img: CDN + '/tote-bags.png' },
];

// Preload image URIs for faster display
const IMAGE_PREFETCH = PRODUCTS.slice(0, 6).map(p => Image.prefetch(p.img));

function ProductCard({ item }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  return (
    <View style={[s.card, { width: CARD_W }]}>
      {/* Image area */}
      <View style={s.imgWrap}>
        {!loaded && !errored && (
          <View style={s.imgPlaceholder}>
            <ActivityIndicator color="#E02020" size="small" />
          </View>
        )}
        {!errored && (
          <Image
            source={{ uri: item.img, cache: 'force-cache' }}
            style={[s.img, { opacity: loaded ? 1 : 0 }]}
            resizeMode="cover"
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
            progressiveRenderingEnabled={true}
            fadeDuration={200}
          />
        )}
        {errored && (
          <View style={s.imgPlaceholder}>
            <Text style={{ fontSize: 28 }}>📦</Text>
          </View>
        )}
        {item.tag && (
          <View style={[s.tag, { backgroundColor: item.tagColor }]}>
            <Text style={[s.tagText, { color: item.tagColor === '#ffd700' || item.tagColor === '#22c55e' ? '#000' : '#fff' }]}>
              {item.tag}
            </Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={s.info}>
        <Text style={s.name} numberOfLines={2}>{item.name}</Text>
        <View style={s.row}>
          <Text style={s.price}>{item.price}</Text>
          <TouchableOpacity
            style={s.btn}
            onPress={() => Linking.openURL('https://realsecuritycamera.com/app?tab=store')}
          >
            <Text style={s.btnText}>Shop</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function StoreScreen() {
  const renderItem = useCallback(({ item }) => <ProductCard item={item} />, []);
  const keyExtractor = useCallback((item) => item.id, []);

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>RSC Store</Text>
        <Text style={s.sub}>Liberation Kits · Cameras · Swag</Text>
      </View>

      <FlatList
        data={PRODUCTS}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={2}
        columnWrapperStyle={s.row2}
        contentContainerStyle={s.list}
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={5}
        removeClippedSubviews={true}
        getItemLayout={(_, index) => ({
          length: CARD_W + 16,
          offset: (CARD_W + 16) * Math.floor(index / 2),
          index,
        })}
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
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '800' },
  sub:   { color: '#555', fontSize: 12, marginTop: 2 },

  list:  { padding: 12, paddingBottom: 40 },
  row2:  { justifyContent: 'space-between', marginBottom: 12 },

  card: {
    backgroundColor: '#111',
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1e1e1e',
  },

  imgWrap: { width: '100%', height: CARD_W * 0.75, backgroundColor: '#0d0d0d' },
  img: {
    position: 'absolute', top: 0, left: 0,
    width: '100%', height: '100%',
  },
  imgPlaceholder: {
    position: 'absolute', top: 0, left: 0,
    width: '100%', height: '100%',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0d0d0d',
  },
  tag: {
    position: 'absolute', top: 6, left: 6,
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  tagText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },

  info: { padding: 10 },
  name: { color: '#fff', fontSize: 12, fontWeight: '700', marginBottom: 8, lineHeight: 16 },
  row:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  price: { color: '#E02020', fontSize: 15, fontWeight: '900' },
  btn: {
    backgroundColor: '#1a1a1a', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  btnText: { color: '#E02020', fontSize: 11, fontWeight: '700' },

  fullStoreBtn: {
    margin: 16, backgroundColor: '#E02020',
    borderRadius: 10, padding: 14, alignItems: 'center',
  },
  fullStoreBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
