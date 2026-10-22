---
name: blender-sculpt
description: >
  Performs organic and high-poly sculpting in three gated stages: primary
  forms, secondary forms, tertiary detail. Enforces detail locks, form
  hierarchy and neutral-matcap QA. Operates through Blender-MCP.
whenToUse: >
  Use when the asset requires organic or high-poly sculpting, the blockout
  gate has passed, and primary proportions are accepted.
user-invocable: true
---

# blender-sculpt

你负责有机形体的三级雕刻。**每一级都是独立 Gate，不得跨级。**

---

## 1. 前置条件

```text
phase in {primary, secondary, tertiary}
asset requires organic/high-poly sculpt
blockout == pass
primary proportions accepted（进入 S2 后仍需保持）
```

不满足则退回 `blender-modeling`。

---

## 2. 三级结构

```text
S1 PRIMARY FORMS
   cranium / jaw / rib cage / pelvis / limb masses / major silhouette
        ↓ primary_form == pass
S2 SECONDARY FORMS
   muscle groups / bone landmarks / fat pads / major folds / facial planes
        ↓ secondary_form == pass 且 Detail Lock 未触发
S3 TERTIARY DETAIL
   pores / micro wrinkles / fine scales / scratches / engraving
```

### S1 禁止

```text
wrinkles / pores / scars / veins / skin noise / fine scales / tiny folds
```

### S2 允许

```text
muscle groups / bone landmarks / fat pads / major folds /
facial planes / eyelids / lips / nostrils / large skin folds /
armor transitions
```

### S3 允许

```text
pores / micro wrinkles / fine scales / skin breakup / scratches /
tiny cloth folds / engraving / surface imperfections
```

S3 进入条件（全部满足）：

```text
primary_form == pass
secondary_form == pass
silhouette == pass
proportion == pass
high_poly_pre_detail_QA == pass
```

---

## 3. 工作流规范

### 3.1 进入阶段前

```text
1. 获取对象事实
   get_scene_info(root="<asset>", fields=["details","modifiers","materials"],
                  user_prompt="<用户原话>")
2. 用 execute_blender_code 检查多级精度 / remesh 设置与目标面数，并 print 当前值
3. 确认对称轴与 mirror 状态
4. 保存上一 Gate 的 checkpoint
```

雕刻操作全部通过 `execute_blender_code` 设置 multires/remesh 并调用 bpy 数据 API。
每次调整后 `look(mode="angles", views=["front","three_quarter"], shading="solid",
max_size=640)` 快速确认形体，不要每次都全六视角渲染。

### 3.2 面密度策略

```text
S1：低密度，优先快速改形
S2：中等密度，支持次级形体
S3：仅在需要的区域提升密度
规则：detail 分辨率必须 ≥ 该细节最小特征的 3 倍
```

### 3.3 形体层级

```text
永远从大到小：
macro mass → secondary form → tertiary detail
不允许在未完成的大形上雕小形
```

### 3.4 对称

```text
S1/S2 默认对称，便于比较
非对称设计：先对称完成主形，再单独处理差异
切换对称前保存 checkpoint
```

### 3.5 参考比对

```text
每完成一个子项：
- 切到 neutral matcap
- 关闭所有材质与贴图
- 六视角快速比对
- 与比例表核对关键坐标
```

---

## 4. 禁止事项

```text
- 用材质掩盖形体质感
- 在 silhouette 错误时加细节
- 在 S1 使用细节笔刷
- 无 checkpoint 进行 remesh / 大幅重拓扑
- 用 remesh 解决本应手工修的结构问题
- 反复撤销导致状态不确定（操作前先保存）
```

---

## 5. Detail Lock 自查

每次准备进入 S3 前：

```text
if silhouette < threshold:  STOP
if proportion < threshold:  STOP
if primary_form < threshold:  STOP
if secondary_form < threshold:  STOP
if 存在 blocking 解剖缺陷:  STOP
```

阈值见 `blender-expert/references/asset-types.md`。

---

## 6. QA 交接

```text
S1 → QA-02：neutral matcap，六视角 + 正交
S2 → QA-03：六视角 + 面部/关节特写（最关键 Gate）
S3 → QA-04：8 视角 turntable + 细节特写
```

提交 QA 时必须提供：

```text
- 当前阶段与目标面数
- 截图目录
- 已知受限区域（unknowns）
- 本轮改动摘要
```

不得自行宣布通过。

---

## 7. 输出

```text
- 当前阶段（S1/S2/S3）
- 面数变化
- 改动区域清单
- 自查发现的偏差
- next_action
```

---

## 8. References

| 文件 | 何时读取 |
|---|---|
| `references/primary-forms.md` | S1 |
| `references/secondary-forms.md` | S2 |
| `references/tertiary-detail.md` | S3 |
| `references/anatomy.md` | 角色/生物比例与骨点判断 |
| `references/surface-detail.md` | 细节尺度、笔刷与噪点控制 |
