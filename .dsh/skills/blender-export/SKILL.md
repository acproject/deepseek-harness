---
name: blender-export
description: >
  Exports the approved asset: format selection, transform application, naming,
  unit scale, material and texture packaging, LOD and collision handling, and
  re-import validation. Operates through Blender-MCP.
whenToUse: >
  Use when phase is export and final_render has passed, or when the user asks
  for a deliverable package from an approved asset.
user-invocable: true
---

# blender-export

你负责把已通过 QA 的资产变成可交付文件。**不在此阶段修资产。**

---

## 1. 前置条件

```text
final_render == pass
所有 production gates == pass
交付格式与预算已确认（asset.delivery）
```

不满足则退回对应阶段。导出阶段发现的资产缺陷按 Gate Invalidation 处理，
不得在导出时临时修补几何。

---

## 2. 格式选择

```text
FBX     game 引擎（Unity / Unreal），需确认轴向与单位
glTF/GLB  Web / 跨平台，材质与贴图可内嵌
USD     film / 大型场景协作
OBJ     仅几何，无法携带 PBR
BLEND   源文件交付
```

轴向约定：

```text
Blender Z-up → FBX 默认 Y-up（按目标引擎确认）
glTF 为 Y-up
USD 为 Y-up（按管线确认）
```

---

## 3. 工作流

```text
1. 获取场景事实
   get_scene_info(fields=["settings","details","materials","modifiers"],
                  limit=100, user_prompt="<用户原话>")
2. 检查 transform：location/rotation/scale 已 apply
3. 检查单位：1 unit = 1 m（或按项目约定）
4. 清理：隐藏对象、临时对象、未使用材质、孤立数据
5. 命名统一：<asset>_<part>_<lod>
6. 材质与贴图：确认引用路径、打包策略
7. LOD / 碰撞体：按交付要求导出
8. 导出
9. 回读导入空场景验证
10. 生成交付清单
```

导出与回读全部通过 `execute_blender_code` 完成：

```python
# 导出（示例：FBX）
bpy.ops.export_scene.fbx(filepath=out_path, use_selection=True,
                         apply_scale_options='FBX_SCALE_ALL')

# 回读验证：在新场景中导入
bpy.ops.wm.read_homefile(use_empty=True)
bpy.ops.import_scene.fbx(filepath=out_path)
print(len(bpy.data.objects), sum(o.type == 'MESH' for o in bpy.data.objects))
```

回读会切换当前文件，必须先保存当前工作并确认用户允许；或复制文件后在
副本场景中验证，避免丢失未保存改动。

---

## 4. 命名与结构

```text
对象：<asset>_<part>_<lod>       例：orc_body_lod0
材质：<asset>_<part>_mat
贴图：<asset>_<part>_<map>_<size>.png
骨骼：<asset>_rig
```

规则：

```text
- 不使用空格与中文文件名
- 左右对称部件 _L / _R
- LOD 编号从 0 开始
```

---

## 5. 材质与贴图

```text
- 确认贴图路径存在，无丢失
- 决定内嵌或外链（glTF 可内嵌，FBX 通常外链）
- 确认色彩空间在目标引擎中正确
- 金属度/粗糙度贴图打包方式按引擎要求（如 ORM）
- 法线贴图 Y 轴方向与引擎约定一致
```

---

## 6. 回读验证

必须在新场景/新文件中导入导出结果：

```text
[ ] 对象数量与层级正确
[ ] 面数与导出前一致
[ ] 材质与贴图正确加载
[ ] 比例与朝向正确
[ ] 无缺失部件
[ ] 骨骼/变形（如有）正常
[ ] 动画（如有）正常
```

回读截图作为 QA-10 证据。

---

## 7. 交付清单

必须生成 `.blender-agent/reports/export-manifest.md`：

```text
- 资产名与版本
- 导出文件列表（路径、大小）
- 对象与面数
- 材质与贴图清单
- LOD 与碰撞体
- 目标引擎与轴向/单位
- 已知限制与豁免项
- 导出时间
```

---

## 8. 禁止

```text
- 未通过 final_render 就导出
- 在导出阶段修改几何/材质
- 忽略 transform 与单位
- 导出后不做回读验证
- 覆盖唯一源文件
- 丢失贴图引用仍交付
```

---

## 9. QA 交接

```text
export → QA-10：回读截图 + 文件清单
检查：naming / transforms / unit scale / material references /
      texture paths / poly budget / re-import sanity
```

回读后的画面用 `look(image=".blender-agent/qa/export-1/reimport.png")` 查看；
若直接看当前场景，用 `look(mode="camera", shading="material", max_size=1024,
user_prompt="<用户原话>")`。

---

## 10. 输出

```text
- 导出文件路径
- 交付清单路径
- 回读验证结果
- next_action = done 或 needs_review
```
