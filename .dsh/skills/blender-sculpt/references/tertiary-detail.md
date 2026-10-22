# S3 — Tertiary Detail

目标：在不破坏大形的前提下增加真实感表面。

进入条件（全部满足）：

```text
primary_form == pass
secondary_form == pass
silhouette == pass
proportion == pass
high_poly_pre_detail_QA == pass
```

---

## 1. 允许的细节

```text
pores / micro wrinkles / fine scales / skin breakup /
scratches / tiny cloth folds / engraving / surface imperfections
```

---

## 2. 细节尺度层级

```text
macro     跨区域的色调/粗糙变化（属于材质，不是雕刻）
meso      肉眼可辨的起伏（细褶、布料折痕、甲片边缘）
micro     毛孔、细划痕、颗粒
```

规则：

```text
- 每一层只做一件事
- 不要在 micro 层重复 meso 层的形状
- 细节尺度必须与资产交付距离匹配
```

---

## 3. 密度与分辨率

```text
最小特征尺寸 = D
网格分辨率 ≥ 3D
例：毛孔直径 1mm → 网格边长 ≤ 0.33mm
```

达不到时：

```text
提升局部密度 / 分块雕刻 / 交给法线贴图
禁止用低分辨率硬雕出模糊的“假细节”
```

---

## 4. 分布逻辑

```text
- 毛孔：按皮肤张力线分布，关节与摩擦区更密
- 细褶：垂直于肌肉收缩方向
- 划痕：沿使用方向，长度与深度有分布
- 磨损：出现在边缘、凸起、接触面
- 污渍：沉积在凹陷与缝隙
```

禁止均匀噪点式铺满。

---

## 5. 对称

```text
细节默认非对称
但左右密度与尺度等级必须一致
```

---

## 6. 判断标准

```text
[ ] 细节尺度一致，无突然变大的颗粒
[ ] 无过度噪点（over-noising）
[ ] 无 pinching 与笔刷拖尾
[ ] 细节不改变主轮廓
[ ] 特写渲染下自然，不像程序噪声
[ ] 表面节奏有疏密变化
```

---

## 7. 常见错误

```text
- 全表面均匀铺毛孔，像砂纸
- 细节尺度超出网格分辨率，产生模糊块
- 用高 strength 笔刷造成 pinching
- 细节跨越结构转折处（如鼻孔边缘）造成破形
- 在未通过 S2 的区域偷偷加细节掩盖问题
```

---

## 8. 完成动作

```text
1. 保存 checkpoint
2. 提交 QA-04（8 视角 turntable + 细节特写）
3. 通过后进入 high_poly_qa → retopology
```

进入 retopology 后默认 HIGH POLY SHAPE FREEZE。
