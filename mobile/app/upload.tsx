// 丹青有AI 拍照诊断上传页(app/upload.tsx)
// ============================================================
// 页面流程:
//   首页"拍照诊断" → router.push('/upload')
//     ├─ 作品类型 4 选 1(painting/design/product/sculpture,卡片选择)
//     ├─ 标题输入(可选,≤50 字)
//     ├─ 备注输入(可选,≤200 字,多行)
//     ├─ 图片来源:[拍照](Camera Modal 连拍)/ [从相册选择](多选)
//     ├─ 已选图片预览(FlashList 横向,缩略图 + 右上角 X 删除,可追加)
//     └─ 底部"开始诊断"按钮(禁用:无图 / 未登录 / 提交中)
//
// 上传策略:
//   - 逐张串行上传(避免并发压垮后端),artType/title/remark 为页面级共用
//   - 每张独立返回 analysisId,单张失败不中断整体
//   - 全部完成:汇总卡片(成功 X 张,失败 Y 张)+ [查看报告](跳首张成功的 /analysis/[id]) + [继续拍](清空重置)
//
// 技术约束:
//   - 跨端类型(ArtType/CreateAnalysisResponse)从 src/types/api-contract.ts 导入
//   - FormData 用类型断言绕过 RN 与 DOM 类型差异(见 services/analyses.ts)
//   - 水墨色系:InkColor/PaperColor/CinnabarColor/StoneBlueColor/GoldColor
//   - FlashList 用于已选图片预览(项目要求 never use FlatList)
//   - 单次请求 axios timeout 30000ms(后端 AI 2500ms 硬超时 + 上传 + 网络余量)
// ============================================================
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Keyboard,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../src/store';
import { ApiError } from '../src/services/api';
import {
  uploadAnalysis,
  type UploadImageFile,
} from '../src/services/analyses';
import { UploadCameraModal } from '../src/components/UploadCameraModal';
import type { ArtType } from '../src/types/api-contract';
import {
  CinnabarColor,
  InkColor,
  PaperColor,
  StoneBlueColor,
} from '../src/theme/colors';

// ---- 本地 UI 类型(非跨端契约)----
/** 待上传图片项(本地 uri + 元信息) */
interface PendingImage {
  id: string;
  uri: string;
  type: string;
  fileName: string;
}

/** 单张上传结果 */
interface UploadResultItem {
  imageId: string;
  status: 'success' | 'failed';
  analysisId?: string;
  error?: string;
}

/** ArtType 4 选 1 配置 */
const ART_TYPE_OPTIONS: ReadonlyArray<{ value: ArtType; label: string }> = [
  { value: 'painting', label: '绘画' },
  { value: 'design', label: '设计' },
  { value: 'product', label: '产品' },
  { value: 'sculpture', label: '雕塑' },
];

/** 生成本地唯一 ID(避免引入 uuid 依赖) */
function genId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function UploadScreen() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // ---- 表单状态 ----
  const [artType, setArtType] = useState<ArtType>('painting');
  const [title, setTitle] = useState('');
  const [remark, setRemark] = useState('');
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);

  // ---- 拍照 Modal ----
  const [cameraVisible, setCameraVisible] = useState(false);

  // ---- 上传进度 / 结果 ----
  const [uploading, setUploading] = useState(false);
  const [uploadIndex, setUploadIndex] = useState(0); // 当前上传第 i+1 张(0-based)
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadResults, setUploadResults] = useState<UploadResultItem[]>([]);
  const [uploadFinished, setUploadFinished] = useState(false);

  // ---- 派生状态 ----
  const canSubmit =
    isAuthenticated &&
    !uploading &&
    pendingImages.length > 0 &&
    !uploadFinished;

  const successCount = useMemo(
    () => uploadResults.filter((r) => r.status === 'success').length,
    [uploadResults],
  );
  const failedCount = uploadResults.length - successCount;
  const firstSuccessId = useMemo(() => {
    const hit = uploadResults.find((r) => r.status === 'success');
    return hit?.analysisId ?? null;
  }, [uploadResults]);

  // ---- 拍照回调(连拍)----
  const onCameraCapture = useCallback(
    (photo: { uri: string; type: string; fileName: string }) => {
      setPendingImages((prev) => [
        ...prev,
        {
          id: genId(),
          uri: photo.uri,
          type: photo.type,
          fileName: photo.fileName,
        },
      ]);
    },
    [],
  );

  // ---- 相册多选 ----
  const onPickFromAlbum = useCallback(async () => {
    // 相册权限:iOS PHPicker 无需显式请求;Android 需 READ_EXTERNAL_STORAGE
    const permReq = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permReq.granted) {
      Alert.alert(
        '需要相册权限',
        '请在系统设置中开启相册权限,以便选择艺术作品',
        [
          { text: '取消', style: 'cancel' },
          { text: '去设置', onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
        allowsEditing: false,
      });
      if (result.canceled) return;
      const newImages: PendingImage[] = (result.assets ?? []).map((a) => ({
        id: genId(),
        uri: a.uri,
        type: a.mimeType || 'image/jpeg',
        fileName: a.fileName || `photo-${Date.now()}-${genId()}.jpg`,
      }));
      if (newImages.length > 0) {
        setPendingImages((prev) => [...prev, ...newImages]);
      }
    } catch {
      Alert.alert('选择图片失败', '请稍后重试');
    }
  }, []);

  // ---- 删除单张待上传图 ----
  const onRemoveImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  // ---- 提交:逐张串行上传 ----
  const onSubmit = useCallback(async () => {
    if (!canSubmit || pendingImages.length === 0) return;
    Keyboard.dismiss();
    setUploading(true);
    setUploadFinished(false);
    setUploadTotal(pendingImages.length);
    setUploadIndex(0);
    setUploadResults([]);

    const trimmedTitle = title.trim();
    const trimmedRemark = remark.trim();

    const results: UploadResultItem[] = [];
    for (let i = 0; i < pendingImages.length; i += 1) {
      const img = pendingImages[i];
      setUploadIndex(i);
      const imageFile: UploadImageFile = {
        uri: img.uri,
        type: img.type,
        fileName: img.fileName,
      };
      try {
        const resp = await uploadAnalysis({
          image: imageFile,
          artType,
          title: trimmedTitle || undefined,
          remark: trimmedRemark || undefined,
        });
        results.push({
          imageId: img.id,
          status: 'success',
          analysisId: resp.id,
        });
      } catch (e) {
        const errMsg =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : '未知错误';
        results.push({
          imageId: img.id,
          status: 'failed',
          error: errMsg,
        });
      }
      // 实时更新结果,便于 UI 显示已成功 / 已失败
      setUploadResults([...results]);
    }

    setUploading(false);
    setUploadFinished(true);
  }, [artType, canSubmit, pendingImages, remark, title]);

  // ---- 重置 / 继续拍 ----
  const onContinue = useCallback(() => {
    setUploadFinished(false);
    setUploadResults([]);
    setUploadTotal(0);
    setUploadIndex(0);
    setPendingImages([]);
    setTitle('');
    setRemark('');
    setArtType('painting');
  }, []);

  // ---- 查看首张成功报告 ----
  const onViewReport = useCallback(() => {
    if (!firstSuccessId) return;
    router.push(`/analysis/${firstSuccessId}`);
  }, [firstSuccessId]);

  // ---- 进度条比例 ----
  const progressRatio =
    uploadTotal > 0 ? uploadResults.length / uploadTotal : 0;

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      {/* 已上传完成:展示结果汇总,隐藏表单 */}
      {uploadFinished ? (
        <View style={styles.finishedWrap}>
          <View
            style={[
              styles.summaryCard,
              failedCount > 0 ? styles.summaryCardHasFail : null,
            ]}
          >
            <Ionicons
              name={failedCount === 0 ? 'checkmark-circle' : 'warning'}
              size={48}
              color={failedCount === 0 ? StoneBlueColor : CinnabarColor}
            />
            <Text style={styles.summaryTitle}>上传完成</Text>
            <Text style={styles.summaryDesc}>
              成功 <Text style={styles.summarySuccess}>{successCount}</Text> 张
              {failedCount > 0 ? (
                <Text>
                  ,失败 <Text style={styles.summaryFail}>{failedCount}</Text> 张
                </Text>
              ) : null}
              ,共 {uploadTotal} 张
            </Text>

            {failedCount > 0 ? (
              <Text style={styles.summaryHint}>失败的图片可稍后单独重试</Text>
            ) : null}
          </View>

          <View style={styles.finishedActions}>
            {firstSuccessId ? (
              <Pressable
                style={({ pressed }) => [
                  styles.actionBtn,
                  styles.actionPrimary,
                  pressed && styles.pressed,
                ]}
                onPress={onViewReport}
              >
                <Ionicons name="document-text" size={18} color={PaperColor} />
                <Text style={styles.actionPrimaryText}>查看报告</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                firstSuccessId ? styles.actionSecondary : styles.actionPrimary,
                pressed && styles.pressed,
              ]}
              onPress={onContinue}
            >
              <Ionicons
                name="camera"
                size={18}
                color={firstSuccessId ? StoneBlueColor : PaperColor}
              />
              <Text
                style={
                  firstSuccessId
                    ? styles.actionSecondaryText
                    : styles.actionPrimaryText
                }
              >
                继续拍
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.formWrap}>
          {/* 未登录提示 */}
          {!isAuthenticated ? (
            <View style={styles.loginHint}>
              <Ionicons name="lock-closed" size={22} color={`${InkColor}55`} />
              <Text style={styles.loginHintText}>
                请先登录后再上传作品(P3-1.4 接入登录)
              </Text>
            </View>
          ) : null}

          {/* 作品类型选择 */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              作品类型 <Text style={styles.required}>*</Text>
            </Text>
            <View style={styles.artTypeRow}>
              {ART_TYPE_OPTIONS.map((opt) => {
                const active = artType === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    style={({ pressed }) => [
                      styles.artTypeChip,
                      active && styles.artTypeChipActive,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => setArtType(opt.value)}
                    disabled={uploading}
                  >
                    <Text
                      style={[
                        styles.artTypeChipText,
                        active && styles.artTypeChipTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 标题输入 */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>标题</Text>
            <TextInput
              style={styles.textInput}
              value={title}
              onChangeText={setTitle}
              placeholder="可选,如:静物素描练习"
              placeholderTextColor={`${InkColor}55`}
              maxLength={50}
              editable={!uploading}
              returnKeyType="next"
            />
            <Text style={styles.inputCounter}>{title.length}/50</Text>
          </View>

          {/* 备注输入 */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>备注</Text>
            <TextInput
              style={[styles.textInput, styles.textInputMultiline]}
              value={remark}
              onChangeText={setRemark}
              placeholder="可选,如作业要求 / 创作意图"
              placeholderTextColor={`${InkColor}55`}
              maxLength={200}
              multiline
              editable={!uploading}
              textAlignVertical="top"
            />
            <Text style={styles.inputCounter}>{remark.length}/200</Text>
          </View>

          {/* 图片来源 */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              作品图片 <Text style={styles.required}>*</Text>
            </Text>
            <View style={styles.sourceRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.sourceBtn,
                  pressed && styles.pressed,
                  uploading && styles.sourceBtnDisabled,
                ]}
                onPress={() => setCameraVisible(true)}
                disabled={uploading}
              >
                <Ionicons name="camera" size={22} color={PaperColor} />
                <Text style={styles.sourceBtnText}>拍照</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.sourceBtn,
                  styles.sourceBtnSecondary,
                  pressed && styles.pressed,
                  uploading && styles.sourceBtnDisabled,
                ]}
                onPress={onPickFromAlbum}
                disabled={uploading}
              >
                <Ionicons name="images" size={22} color={StoneBlueColor} />
                <Text style={styles.sourceBtnSecondaryText}>从相册选择</Text>
              </Pressable>
            </View>
          </View>

          {/* 已选图片预览(FlashList 横向) */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              已选图片({pendingImages.length})
            </Text>
            {pendingImages.length === 0 ? (
              <View style={styles.emptyPreview}>
                <Ionicons name="image-outline" size={28} color={`${InkColor}40`} />
                <Text style={styles.emptyPreviewText}>
                  点击上方按钮拍照或选择图片
                </Text>
              </View>
            ) : (
              <View style={styles.previewListWrap}>
                <FlashList
                  data={pendingImages}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <View style={styles.thumbWrap}>
                      <Image
                        source={{ uri: item.uri }}
                        style={styles.thumb}
                        resizeMode="cover"
                      />
                      <Pressable
                        style={({ pressed }) => [
                          styles.thumbDelete,
                          pressed && styles.pressed,
                        ]}
                        onPress={() => onRemoveImage(item.id)}
                        disabled={uploading}
                        accessibilityLabel="删除图片"
                      >
                        <Ionicons name="close" size={14} color={PaperColor} />
                      </Pressable>
                    </View>
                  )}
                  ItemSeparatorComponent={() => <View style={{ width: 10 }} />}
                  ListFooterComponent={
                    <Pressable
                      style={({ pressed }) => [
                        styles.thumbAdd,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => setCameraVisible(true)}
                      disabled={uploading}
                      accessibilityLabel="继续拍照"
                    >
                      <Ionicons name="add" size={24} color={StoneBlueColor} />
                      <Text style={styles.thumbAddText}>继续拍</Text>
                    </Pressable>
                  }
                />
              </View>
            )}
          </View>

          {/* 上传进度 */}
          {uploading ? (
            <View style={styles.progressCard}>
              <Text style={styles.progressText}>
                正在上传第 {uploadIndex + 1}/{uploadTotal} 张…
              </Text>
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.round(progressRatio * 100)}%` },
                  ]}
                />
              </View>
              <Text style={styles.progressMeta}>
                已完成 {uploadResults.length}/{uploadTotal}(成功 {successCount}
                ,失败 {failedCount})
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {/* 底部"开始诊断"按钮(拇指可达区,固定底部) */}
      {!uploadFinished ? (
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.submitBtn,
              !canSubmit && styles.submitBtnDisabled,
              pressed && canSubmit && styles.pressed,
            ]}
            onPress={onSubmit}
            disabled={!canSubmit}
          >
            <Ionicons name="sparkles" size={18} color={PaperColor} />
            <Text style={styles.submitBtnText}>
              {uploading
                ? `上传中 ${uploadIndex + 1}/${uploadTotal}`
                : `开始诊断${pendingImages.length > 0 ? `(${pendingImages.length} 张)` : ''}`}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* 拍照 Modal(连拍) */}
      <UploadCameraModal
        visible={cameraVisible}
        onClose={() => setCameraVisible(false)}
        onCapture={onCameraCapture}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PaperColor,
  },
  formWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  // ---- 未登录提示 ----
  loginHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: `${InkColor}0a`,
  },
  loginHintText: {
    flex: 1,
    color: InkColor,
    fontSize: 13,
    opacity: 0.65,
  },
  // ---- 通用 section ----
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: InkColor,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  required: {
    color: CinnabarColor,
  },
  pressed: {
    opacity: 0.8,
  },
  // ---- ArtType 4 选 1 ----
  artTypeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  artTypeChip: {
    flex: 1,
    minWidth: 72,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: `${InkColor}1a`,
  },
  artTypeChipActive: {
    backgroundColor: StoneBlueColor,
    borderColor: StoneBlueColor,
  },
  artTypeChipText: {
    color: InkColor,
    fontSize: 14,
    fontWeight: '500',
  },
  artTypeChipTextActive: {
    color: PaperColor,
    fontWeight: '600',
  },
  // ---- 文本输入 ----
  textInput: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: InkColor,
    borderWidth: 1,
    borderColor: `${InkColor}1a`,
  },
  textInputMultiline: {
    minHeight: 80,
    paddingTop: 12,
  },
  inputCounter: {
    marginTop: 6,
    color: InkColor,
    fontSize: 12,
    opacity: 0.45,
    textAlign: 'right',
  },
  // ---- 图片来源按钮 ----
  sourceRow: {
    flexDirection: 'row',
    gap: 12,
  },
  sourceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: StoneBlueColor,
  },
  sourceBtnSecondary: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: StoneBlueColor,
  },
  sourceBtnDisabled: {
    opacity: 0.5,
  },
  sourceBtnText: {
    color: PaperColor,
    fontSize: 15,
    fontWeight: '600',
  },
  sourceBtnSecondaryText: {
    color: StoneBlueColor,
    fontSize: 15,
    fontWeight: '600',
  },
  // ---- 已选图片预览 ----
  emptyPreview: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
    borderStyle: 'dashed',
  },
  emptyPreviewText: {
    color: InkColor,
    fontSize: 13,
    opacity: 0.5,
  },
  previewListWrap: {
    paddingVertical: 4,
  },
  thumbWrap: {
    position: 'relative',
    width: 88,
    height: 88,
  },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: 10,
    backgroundColor: `${InkColor}0d`,
  },
  thumbDelete: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: CinnabarColor,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  thumbAdd: {
    width: 88,
    height: 88,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: StoneBlueColor,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  thumbAddText: {
    color: StoneBlueColor,
    fontSize: 11,
    fontWeight: '500',
  },
  // ---- 进度卡片 ----
  progressCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
    gap: 8,
  },
  progressText: {
    color: InkColor,
    fontSize: 14,
    fontWeight: '600',
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: `${InkColor}1a`,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: StoneBlueColor,
  },
  progressMeta: {
    color: InkColor,
    fontSize: 12,
    opacity: 0.6,
  },
  // ---- 底部按钮 ----
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: PaperColor,
    borderTopColor: `${InkColor}1a`,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: StoneBlueColor,
  },
  submitBtnDisabled: {
    backgroundColor: `${InkColor}33`,
  },
  submitBtnText: {
    color: PaperColor,
    fontSize: 16,
    fontWeight: '700',
  },
  // ---- 完成态 ----
  finishedWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 24,
    justifyContent: 'center',
  },
  summaryCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${StoneBlueColor}4d`,
  },
  summaryCardHasFail: {
    borderColor: `${CinnabarColor}4d`,
  },
  summaryTitle: {
    color: InkColor,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 6,
  },
  summaryDesc: {
    color: InkColor,
    fontSize: 15,
    opacity: 0.8,
    textAlign: 'center',
  },
  summarySuccess: {
    color: StoneBlueColor,
    fontWeight: '700',
    fontSize: 18,
  },
  summaryFail: {
    color: CinnabarColor,
    fontWeight: '700',
    fontSize: 18,
  },
  summaryHint: {
    color: InkColor,
    fontSize: 12,
    opacity: 0.55,
    marginTop: 4,
  },
  finishedActions: {
    marginTop: 20,
    gap: 12,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  actionPrimary: {
    backgroundColor: StoneBlueColor,
  },
  actionSecondary: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: StoneBlueColor,
  },
  actionPrimaryText: {
    color: PaperColor,
    fontSize: 16,
    fontWeight: '700',
  },
  actionSecondaryText: {
    color: StoneBlueColor,
    fontSize: 16,
    fontWeight: '700',
  },
});
