# PBR

---

## 1. 金属度/粗糙度工作流

```text
Base Color     反照率（非金属）或反射色（金属）
Metallic       0 = 非金属，1 = 金属
Roughness      微观粗糙度
Normal         切线空间法线
AO             环境遮蔽（可烘焙或程序生成）
```

规则：

```text
- 同一材质内 metallic 尽量二元
- 过渡区（锈蚀、污渍）可用中间值，但要与 roughness 联动
- 非金属 base color 不应低于 0.04（避免死黑）
```

---

## 2. 能量守恒

```text
高 metallic → 低 diffuse，高 specular
高 roughness → 宽高光，低反射清晰度
避免：高 metallic + 低 roughness + 高 base color 同时出现
```

---

## 3. 分层噪波

```text
不要：
Noise(scale=5) + Noise(scale=50) + Noise(scale=500) 直接相加

应该：
1. 低频层控制整体色差（scale 大，对比低）
2. 中频层控制材质过渡（边缘、沉积）
3. 高频层只作用于 roughness / normal，不改变 base color
4. 每层用 mask 限定区域，不做全域叠加
```

---

## 4. 边缘与磨损

```text
- 边缘磨损：曲率遮罩（curvature/AO 反相）
- 缝隙污渍：AO 遮罩
- 凸起磨亮：曲率 + 朝向遮罩
```

禁止全表面均匀磨损。

---

## 5. 法线与凹凸

```text
- 法线贴图用于烘焙细节
- bump 仅用于程序细节，强度低于法线
- 不要叠加两层同频率法线
- 检查 tangent 方向与 UV 岛旋转一致
```

---

## 6. 色彩空间

```text
sRGB：base color、emission、transmission color
Non-Color：normal、roughness、metallic、AO、displacement、mask
```

错误设置会导致明度与反射异常。

---

## 7. 双灯光验证

```text
Neutral studio：检查能量、明度、粗糙度层次
HDRI：检查环境反射、边缘高光、材质在真实环境下的表现
```

两套都通过才算 material pass。

---

## 8. 交付前检查

```text
[ ] 无纯黑/纯白
[ ] metallic 无异常中间值
[ ] roughness 有层次，非单值
[ ] 法线方向正确
[ ] 贴图色彩空间正确
[ ] 无贴图路径缺失
[ ] 命名统一
```
