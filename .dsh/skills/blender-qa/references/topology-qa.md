# Topology & UV QA

线框与 UV 的判定方法。

---

## 1. 线框检查准备

```text
- 开启 wireframe overlay
- 关闭材质与贴图（uniform 显示）
- 视角：front / side / 3-4 / joint closeups / face closeup
- 分辨率足以看清单条边
```

---

## 2. 拓扑检查项

### edge flow

```text
- 环线沿形体走向
- 无突然转向、无 Z 字形
- 关节处环线连续
```

### poles

```text
- 极点数量合理
- 不在变形区、高光区、硬边
- 无连续极点群
```

### spirals

```text
- 无螺旋状边流（会导致细分与形变异常）
```

### triangles / ngons

```text
- 曲面上无 n-gon
- 变形区无三角面
- 硬表面允许，但验证 shading 与细分
```

### density

```text
- 曲率大处密、平坦处疏
- 无长宽比 > 4 的细长面
- 无密度突变边界
```

### deformation loops

```text
- 关节中心环线存在
- 眼/口环线闭环
- 手指各关节有环线
```

---

## 3. 量化检查

```text
- 总面数 vs 预算
- 非流形边数量（应为 0，刻意开放边界除外）
- 零面积面数量（应为 0）
- 重复顶点数量（应为 0）
- n-gon 数量（按目标允许范围）
- 左右对称区域的拓扑一致性
```

---

## 4. UV 检查准备

```text
- UV layout 截图
- checker texture 渲染（多角度）
- seam 位置标注
```

---

## 5. UV 检查项

```text
stretching       棋盘格是否接近正方形
texel density    全资产是否一致（特写区允许 1.5–2×，需记录）
padding          低 mip 是否渗色
island orientation 岛方向是否统一
seams            是否位于隐藏面/硬边/材质分界
overlap          是否有非预期重叠岛
zero area        是否有零面积岛
```

量化：

```text
TD 偏差 = (max TD - min TD) / max TD
> 10% → high（特写区除外）
```

---

## 6. 判定要点

```text
- 线框问题必须能定位到具体边/环线
- 不凭整体观感判定拓扑
- UV 问题必须结合 checker 渲染，不能只看 layout
- 允许项（硬表面三角/五边）需在结论中显式声明
```

---

## 7. 常见误判

```text
- 把硬表面合理三角面当成错误
- 只看 UV layout，不看 checker 拉伸
- 忽略岛旋转导致的法线方向问题
- 把密度突变当成风格化处理
- 未测试极限角度就判定 deformation loop 合格
```

---

## 8. 输出

```text
- 线框截图路径
- UV layout 与 checker 路径
- 问题清单（位置、类型、severity）
- 豁免项清单
```
