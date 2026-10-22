---
name: blender-reference-analysis
description: >
  Converts reference images and briefs into a measurable modeling brief:
  proportion map, silhouette characteristics, primary masses, secondary
  forms, material regions, symmetry assumptions, unknowns and confidence.
  Never creates geometry.
whenToUse: >
  Use when starting a new asset, when reference images exist, when the user
  asks to replicate an object, or when the asset is a character, creature,
  product or other modeled subject.
user-invocable: true
---

# blender-reference-analysis

你负责把“参考”翻译成可执行的建模指标。你不创建任何几何体。

---

## 1. 前置条件

```text
phase == reference
gate reference == pending
```

若参考图不足，先向用户索取，不要凭空补全。

---

## 2. 强制输出

必须产出以下 9 项，缺一不可：

```text
1. proportion map
2. silhouette characteristics
3. primary masses
4. secondary forms
5. material regions
6. symmetry assumptions
7. unknown / hidden areas
8. reference confidence
9. modeling constraints
```

输出落盘到 `.blender-agent/reports/reference-analysis.md`（可附 `reference-analysis.json`）。

---

## 3. 流程

### 3.1 视图识别

```text
- 列出可用视图：front / back / left / right / 3-4 / top / bottom / closeup
- 标注镜头焦段与透视畸变风险
- 判断是否为同一角色/物体的同一版本
- 若多视图不一致，标记冲突，不擅自取平均
```

逐张查看参考（`look` 支持直接显示文件路径）：

```text
look(image="/abs/path/ref_front.png", max_size=1024, user_prompt="<用户原话>")
```

一次看一张，先记录测量点，再换下一张。不要把整批图片一次性塞进上下文。

### 3.2 建立比例基准

```text
1. 选一个不随姿态变化的主尺度（身高 / 总长 / 最大宽）
2. 归一化为 1.0
3. 所有其他测量以该基准的百分比表达
4. 记录测量点在图像中的像素坐标，便于复测
```

### 3.3 Proportion Map

按高度切片测量，至少包含：

```text
- 总高 / 总宽 / 总深
- 头高与全身比例（角色用 head units）
- 肩宽、腰宽、髋宽
- 上肢/下肢分段长度
- 关键关节位置（相对总高百分比）
- 最大围度出现的高度
```

输出表格：

| 部位 | 相对值 | 来源视图 | 像素坐标 | 置信度 |
|---|---|---|---|---|
| total_height | 1.000 | front | (x0,y0)-(x1,y1) | high |
| head_height | 0.125 | front | ... | high |
| shoulder_width | 0.310 | front | ... | high |
| ... | | | | |

### 3.4 Silhouette Characteristics

用形状语言描述，不用形容词堆砌：

```text
- 主导几何：block / taper / curve / wedge / sphere
- 外轮廓的转折点数量与位置
- 负空间形状（腋下、裆部、腿间）
- 最宽/最窄处的视觉重量
- 上下重心分布
```

### 3.5 Primary Masses

列出 3–8 个体块，每个包含：

```text
名称 / 近似几何 / 尺寸比例 / 朝向 / 与其他体块的连接方式
```

### 3.6 Secondary Forms

列出进入 secondary 阶段要做的结构：

```text
肌肉群 / 骨点 / 脂肪垫 / 主要褶皱 / 面部平面 /
眼睑 / 唇 / 鼻孔 / 装甲过渡
```

每个标注 `visible | partially_visible | inferred`。

### 3.7 Material Regions

```text
- 材质分区边界（用部位或坐标描述）
- 光泽度差异
- 磨损/污渍/边缘破损的分布逻辑
- 透明度、发光、毛发等特殊区域
```

### 3.8 Symmetry

```text
- 轴：X / Y / Z，以哪个平面为镜像面
- 对称程度：exact / near / asymmetric_by_design
- 明确的非对称特征清单（疤痕、单侧装备、姿态）
```

### 3.9 Unknown / Hidden Areas

必须显式列出看不见的部分：

```text
- 被遮挡区域
- 参考中模糊或过曝区域
- 多视图冲突区域
```

处理规则：

```text
能推断 → 标注 "inferred"，给出依据
不能推断 → 标注 "unknown"，在建模时向用户确认或采用最小假设
禁止把 unknown 当成确定信息写进比例表
```

### 3.10 Reference Confidence

```text
high    ≥ 3 个正交/近正交视图，光照均匀，无畸变
medium  1–2 个视图，或存在轻微透视
low     仅单视图、遮挡严重、分辨率不足、或风格化参考
```

---

## 4. Pass 条件

```text
- 9 项输出齐全
- 至少 3 个主尺度可量化
- unknowns 已显式列出，且不影响 blockout 起步
- confidence != low，或 low 时用户已确认按推断执行
```

不满足则 `reference = fail`，回到补充参考。

---

## 5. 禁止

```text
- 创建几何体
- 凭“看起来像”给比例
- 省略 unknowns
- 把不同版本/不同角色的参考混用
- 用材质掩盖比例问题（本阶段无材质）
```

---

## 6. 交付给 blender-modeling

```text
- proportion map 表格
- silhouette 描述
- primary masses 列表
- symmetry 轴与例外
- modeling constraints（面数预算、可动性、交付格式）
```

下一阶段：`phase = blockout`，加载 `blender-modeling`。
