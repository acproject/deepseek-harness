---
name: blender-modeling
description: >
  Builds blockout and primary geometry: primitive construction, proportions,
  silhouette, booleans, bevels, support topology, subdivision control and
  major hard-surface mechanical structure. Operates through Blender-MCP.
whenToUse: >
  Use when phase is blockout or primary for hard-surface assets, when
  structural or proportion changes require geometry-level work, or when the
  asset is a prop, vehicle, product or mechanical design.
user-invocable: true
---

# blender-modeling

你负责**结构**，不负责表面细节，也不负责雕刻解剖。

---

## 1. 前置条件

```text
phase in {blockout, primary}
且 gate 前置已 pass
```

进入前必须读取 reference-analysis 的比例表。没有比例表时先退回 reference 阶段。

---

## 2. 场景准备（每次进入必做）

```text
1. 获取场景事实
   get_scene_info(fields=["settings"], user_prompt="<用户原话>")
   get_scene_info(fields=["location","size","materials","modifiers","details"], limit=50,
                  user_prompt="<用户原话>")
2. 确认单位与缩放（scene scale），必要时用 execute_blender_code 统一
3. 设置镜像轴与对称工作流
4. 建立参考背景图（front / side / 3-4），按比例表对齐
5. 新建/确认工作 collection，避免污染其他资产
```

几何操作全部通过 `execute_blender_code` 完成（bmesh / modifier / 数据 API），
每一步 print 对象名、面数、尺寸与修改器，便于下一步核对。

参考图对齐校验：

```text
用已知主尺度校准参考平面尺寸
检查三个视图的同一特征点是否落在同一高度
不一致时以比例表为准，不以图片像素为准
```

---

## 3. Blockout 流程

```text
1. 按 primary masses 逐个建立简化体块
2. 每个体块只用少量面，保证可快速修改
3. 用 bool / 拉伸 / 缩放调整体块间关系
4. 合并前先检查轮廓，不合并不可逆结构
5. 对齐比例表的关键坐标
6. 多视角截图，与参考叠图比对
```

体块数量控制：

```text
角色 5–12 个主块
道具 3–8 个主块
机械/载具 按功能模块拆分
```

超出说明拆分过细，先合并再继续。

---

## 4. Primary 阶段

```text
1. 把体块转化为可细分/可倒角的基础网格
2. 修正确认的大形体（胸廓、骨盆、肩线、机械主结构）
3. 建立变形所需的主要 loop（角色/可动部件）
4. 需要有机解剖时停手，交给 blender-sculpt
```

---

## 5. 硬表面要点

```text
- 布尔前先确定最终可见面，避免布尔后难清理
- bevel 用 modifier + angle/weight，不手动切
- panel line 用 inset/extrude 或独立 mesh，深度与宽度统一
- 支撑线只加在需要保持形状的转角
- 平面区域保持最少面，曲率处加密
- 避免非流形、零面积面、重复顶点
```

详见 `references/hard-surface.md`。

---

## 6. 有机结构要点

```text
- 用低面 base mesh 控制比例，不在 blockout 阶段做肌肉细节
- 关节处预留足够环线，便于后续细分与形变
- 对称使用 Mirror，非对称特征在 mirror 之后单独处理
- 保持四边面为主，允许必要的三角/五边过渡
```

详见 `references/organic.md`。

---

## 7. 禁止事项（BLOCKOUT 未通过时）

```text
micro bevel
tiny panel line
pores
wrinkles
scratches
ornament
cloth weave
skin detail
tiny bolts
tiny grooves
```

判定规则：

```text
如果删除所有材质，
从 5–10 米视觉距离看轮廓仍然错误：
DO NOT ADD DETAIL.
```

---

## 8. 拓扑要求

```text
- 无零面积面、无重复顶点、无非流形（除刻意开放的边界）
- 法线朝外
- 变换已 apply（scale 为 1）
- modifier 顺序合理，未被意外 apply
- 命名清晰，部件可单独选中
```

详见 `references/topology-guidelines.md`。

---

## 9. QA 交接

阶段完成必须交给 `blender-qa`：

```text
blockout    → QA-01：front/back/left/right/3-4 front/3-4 back
primary     → QA-02：neutral matcap，无材质
```

提交前用与 QA 相同的视角自检：

```text
look(mode="angles", target=["<asset>"],
     views=["front","back","left","right","three_quarter"],
     shading="solid", max_size=768, user_prompt="<用户原话>")
```

自检图不落盘；归档由 `blender-qa` 按 gate 渲染到 `.blender-agent/qa/`。

向 QA 提供：

```text
- 截图目录
- 比例表路径
- 本阶段声明的约束（面数、可动性）
- 已知 unknowns 及采用的假设
```

---

## 10. 输出

```text
- 场景状态摘要（对象、面数、modifier）
- 截图路径
- 与比例表的偏差清单（自查）
- next_action
```

不得自行宣布 gate pass。

---

## 11. References

| 文件 | 何时读取 |
|---|---|
| `references/organic.md` | 角色/生物/可变形资产 |
| `references/hard-surface.md` | 机械/道具/载具/产品 |
| `references/topology-guidelines.md` | 任何阶段提交 QA 前 |
