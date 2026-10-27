// 丹青有AI 拍照 Modal(expo-camera SDK 51 CameraView)
// - 全屏 Modal,拍完不关闭,支持连拍(每张回调 onCapture,由父组件加入待上传列表)
// - 权限处理:useCameraPermissions hook
//   * 未授予:显示"授予权限" + "打开系统设置" + "关闭"
//   * 已授予:CameraView + 顶部 X 关闭 + 底部快门 + 摄像头翻转
// - 拍照后图片 quality=0.8 压缩,后端做魔数权威校验
// - 单手持机:快门按钮居中下方拇指可达区,翻转按钮右下
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import {
  CinnabarColor,
  InkColor,
  PaperColor,
  StoneBlueColor,
} from '../theme/colors';

/** 拍照返回的图片信息(供父组件加入待上传列表) */
export interface CapturedPhoto {
  uri: string;
  type: string;
  fileName: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onCapture: (photo: CapturedPhoto) => void;
}

type Facing = 'front' | 'back';

export function UploadCameraModal({ visible, onClose, onCapture }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<Facing>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const [taking, setTaking] = useState(false);
  const insets = useSafeAreaInsets();

  const takePicture = async () => {
    if (taking) return;
    setTaking(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.8,
        skipProcessing: false,
      });
      if (photo?.uri) {
        // expo-camera 生成的临时文件 URI 末段即为文件名;兜底用时间戳
        const segs = photo.uri.split('/');
        const fileName = segs[segs.length - 1] || `photo-${Date.now()}.jpg`;
        onCapture({
          uri: photo.uri,
          type: 'image/jpeg',
          fileName,
        });
      }
    } catch {
      // 拍照失败:静默忽略,用户可重试(避免连拍场景下单次失败打断流程)
    } finally {
      setTaking(false);
    }
  };

  const flipCamera = () => {
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
  };

  // 权限状态尚未加载完成
  if (!permission) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={PaperColor} size="large" />
        </View>
      </Modal>
    );
  }

  // 权限未授予:引导用户授权或跳系统设置
  if (!permission.granted) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={styles.permissionWrap}>
          <View style={styles.permissionCard}>
            <Ionicons name="camera" size={36} color={InkColor} />
            <Text style={styles.permissionTitle}>需要相机权限</Text>
            <Text style={styles.permissionDesc}>
              用于拍摄艺术作品进行 AI 诊断,请授予权限或前往系统设置开启
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.permissionBtn,
                styles.permissionPrimary,
                pressed && styles.pressed,
              ]}
              onPress={requestPermission}
            >
              <Text style={styles.permissionPrimaryText}>授予权限</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.permissionBtn,
                styles.permissionSecondary,
                pressed && styles.pressed,
              ]}
              onPress={() => Linking.openSettings()}
            >
              <Text style={styles.permissionSecondaryText}>打开系统设置</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.permissionBtn,
                pressed && styles.pressed,
              ]}
              onPress={onClose}
            >
              <Text style={styles.permissionCloseText}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  // 权限已授予:全屏相机预览 + 控制层
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <CameraView
          ref={cameraRef}
          facing={facing}
          style={StyleSheet.absoluteFill}
          // 主动模式以保证快门响应;mute 避免连拍快门音叠加
          mode="picture"
          mute
        >
          {/* 顶部控制层(关闭按钮) */}
          <View
            style={[styles.topOverlay, { paddingTop: insets.top + 8 }]}
            pointerEvents="box-none"
          >
            <Pressable
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
              onPress={onClose}
              accessibilityLabel="关闭相机"
            >
              <Ionicons name="close" size={28} color={PaperColor} />
            </Pressable>
          </View>

          {/* 底部控制层(快门 + 翻转) */}
          <View
            style={[styles.bottomOverlay, { paddingBottom: insets.bottom + 16 }]}
            pointerEvents="box-none"
          >
            <View style={styles.bottomPlaceholder} />
            <Pressable
              style={({ pressed }) => [
                styles.shutter,
                pressed && styles.pressed,
                taking && styles.shutterDisabled,
              ]}
              onPress={takePicture}
              disabled={taking}
              accessibilityLabel="拍照"
            >
              <View style={styles.shutterInner} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
              onPress={flipCamera}
              accessibilityLabel="翻转摄像头"
            >
              <Ionicons name="camera-reverse" size={28} color={PaperColor} />
            </Pressable>
          </View>

          {taking ? (
            <View style={styles.takingMask} pointerEvents="none">
              <ActivityIndicator color={PaperColor} size="large" />
              <Text style={styles.takingText}>拍摄中…</Text>
            </View>
          ) : null}
        </CameraView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingWrap: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ---- 权限引导 ----
  permissionWrap: {
    flex: 1,
    backgroundColor: PaperColor,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  permissionCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${InkColor}1a`,
  },
  permissionTitle: {
    color: InkColor,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  permissionDesc: {
    color: InkColor,
    fontSize: 14,
    opacity: 0.65,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  permissionBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  permissionPrimary: {
    backgroundColor: StoneBlueColor,
  },
  permissionPrimaryText: {
    color: PaperColor,
    fontSize: 15,
    fontWeight: '600',
  },
  permissionSecondary: {
    borderWidth: 1,
    borderColor: StoneBlueColor,
  },
  permissionSecondaryText: {
    color: StoneBlueColor,
    fontSize: 15,
    fontWeight: '600',
  },
  permissionCloseText: {
    color: CinnabarColor,
    fontSize: 15,
    fontWeight: '500',
  },
  // ---- 相机控制层 ----
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    alignItems: 'flex-end',
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  bottomPlaceholder: {
    width: 48,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: PaperColor,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: PaperColor,
  },
  shutterDisabled: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.8,
  },
  takingMask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    gap: 10,
  },
  takingText: {
    color: PaperColor,
    fontSize: 14,
    fontWeight: '500',
  },
});
