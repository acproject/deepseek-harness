# Baking

---

## 1. 前置条件

```text
- UV checker QA 通过
- 高低模在同一世界坐标
- 高低模命名与配对关系明确
- transform 已 apply
```

---

## 2. Cage 设置

```text
方式：
1. 自动 cage（按 ray distance）
2. 自定义 cage mesh（更可控，适合复杂结构）

ray distance 起点：
- 有机：包围盒最大边长的 2–5%
- 硬表面：按倒角尺寸的 2–4 倍
- 细长结构：单独提高

调整原则：
- 距离过小 → 漏烘、边缘缺失
- 距离过大 → 捕捉到错误表面、穿插污染
```

---

## 3. 各贴图要点

### Normal

```text
- 使用 tangent space
- 高低模朝向一致
- 硬边需要足够倒角承载
- 检查 Y 轴方向约定（OpenGL / DirectX）与目标引擎一致
```

### AO

```text
- 采样数足够（避免噪点）
- 距离参数按资产尺度设置
- 不与 normal 混用同一 bake pass
```

### Curvature

```text
- 用于材质边缘磨损
- 检查是否出现噪点与过强边缘
```

### Displacement

```text
- 按需烘焙（影视/特写常用）
- 检查 32-bit / 16-bit 精度
- 确认 midlevel 与材质设置一致
```

---

## 4. 常见 Artifact

| 现象 | 原因 | 处理 |
|---|---|---|
| 接缝黑线 | padding 不足 / 采样溢出 | 增加 padding，重烘 |
| 投影错位 | cage 距离不当 / 高低模偏移 | 调整 cage，检查坐标 |
| 斜向条纹 | UV 拉伸 / 岛重叠 | 修 UV，重烘 |
| 硬边丢失 | 倒角段数不足 | 增加几何倒角或接受 |
| 噪点 | AO 采样不足 | 提高采样 |
| 法线翻转 | 高低模朝向不一致 | 统一朝向，检查 Y 轴 |
| 局部漏烘 | ray distance 过小 | 局部提高距离或补 cage |

---

## 5. 判定方式

```text
每张图单独看，不合并判断
检查要点：
- normal：方向正确、无接缝、无错位、硬边合理
- AO：无噪点、接触阴影合理
- curvature：边缘清晰、无过曝
- displacement：无阶梯、无溢出
```

只有全部通过，`bake == pass`。

---

## 6. 失败处理

```text
1. 定位到具体贴图与区域
2. 判断是 UV、cage 还是几何问题
3. 只重烘受影响部分
4. 重新检查，不整组盲烘
```

同一 artifact 连续 2 次修复无改善 → 换策略（改 cage / 改 UV / 改几何），
不要第 3 次原样重试。

---

## 7. 输出清单

```text
[ ] normal（尺寸、色彩空间、Y 轴约定）
[ ] AO
[ ] curvature（如需）
[ ] displacement（如需）
[ ] 每张图的 artifact 检查记录
[ ] 贴图存放路径
```
