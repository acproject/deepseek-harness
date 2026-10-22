# Blender-MCP Contract

本文件把 Skill 的抽象动作绑定到真实的 Blender-MCP 工具。
目标实现：`mcp-for-blender` 2.1.x（本地 `DeepSeekBlenderWorkspace/blender-mcp`），
对应 Blender 插件侧 `addon.py`。

**这是唯一的工具事实来源。Skill 中任何“获取场景快照 / 截图 / 执行操作”的表述，
都必须落到本文件列出的调用上。**

---

## 1. 工具清单

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `get_addon_status` | 连接与版本自检、可用资产库/生成器 | 无 |
| `get_scene_info` | 场景文本事实（对象、尺寸、材质、修改器、拓扑、权重、设置） | `query` `root` `fields` `limit` |
| `look` | 返回一张图（多视角、相机、视口、动画帧、指定图片） | `mode` `target` `views` `shading` `distance` `image` `max_size` |
| `execute_blender_code` | 在用户当前 Blender 里执行 bpy/bmesh/mathutils 代码 | `code` |
| `generate_3d` | 文/图生成一个带贴图模型并导入 | `prompt` `image` `name` `provider` `quality` `job` |
| `search_assets` | 检索 PolyHaven / Sketchfab / PolyPizza | `source` `query` `asset_type` `category` `limit` `previews` |
| `import_asset` | 导入检索到的资产 | `source` `id` `asset_type` `target_size` `apply_to` `resolution` |
| `viewport_*` | 仅 UI 侧截图/点击，生产流程不使用 | — |
| `disable_telemetry` | 隐私开关，与生产无关 | — |

**没有** sculpt / retopo / uv / bake / material / render 专用工具。
所有专业操作都通过 `execute_blender_code` 完成，这就是必须遵守的边界：
Skill 提供“怎么做”的知识，代码负责“怎么调用 bpy”。

---

## 2. 全局调用规则

```text
1. 每个工具调用都传 user_prompt：用户原话，逐字，不转述、不改写、不替换成子目标
2. 不臆造工具名，不使用 GUI 坐标，不依赖当前 selection 猜状态
3. 每次修改前先 get_scene_info；每次修改后再次 get_scene_info 或 look 验证
4. execute_blender_code 只做小步操作，并 print 关键事实（对象名、面数、坐标、修改器）
5. 破坏性操作前先保存 checkpoint（第 6 节）
6. look 会自动还原临时设置，可安全用于 QA；图片会留在会话里，注意 max_size
7. 无法连接 Blender 时立即停止并报告，不尝试启动或杀掉 Blender 进程
```

---

## 3. `get_scene_info` 字段分组

按需取字段，不要一次全取：

```text
placement   location, size, ground, rotation, scale, parent
contents    children, hidden, details, materials, modifiers, animation
health      topology, weights
settings    file, engine, frame range, resolution, camera, HDRI, unit scale
```

常用：

```text
启动核对        get_scene_info(fields=["settings"], user_prompt=...)
对象全貌        get_scene_info(fields=["location","size","materials","modifiers","details"], limit=50)
拓扑 QA         get_scene_info(query="<asset>", fields=["topology","details"])
骨骼/权重 QA    get_scene_info(fields=["weights","animation"])
单个对象层级    get_scene_info(root="<object>", fields=["children","details","modifiers"])
按名查找        get_scene_info(query="<substring>", fields=["location","size"])
```

`topology` 直接返回 quads / tris / ngons / non-manifold / boundary / loose verts / poles，
是 QA-05 的量化证据来源，不要再用脚本重复计算。

---

## 4. `look` 用法

```text
mode      viewport（默认）| camera | angles | frames
shading   solid | material | rendered（EEVEE/Workbench）| wireframe | xray
views     最多 6 个：front back left right top three_quarter，或 [x,y,z]
target    对象名列表，默认所有可见对象
distance  眼睛到目标中心的米数，默认自动取景
image     改为显示指定图片："Render Result"、文件内图像或文件路径
max_size  最长边像素，默认 768
```

标准调用：

```text
六视角形体 QA
look(mode="angles",
     target=["<asset>"],
     views=["front","back","left","right","three_quarter"],
     shading="solid", max_size=768,
     user_prompt="<用户原话>")

线框拓扑 QA
look(mode="angles",
     target=["<asset>_low"],
     views=["front","left","three_quarter"],
     shading="wireframe", max_size=1024,
     user_prompt="<用户原话>")

骨骼透视检查
look(mode="angles", views=["front","three_quarter"], shading="xray", max_size=1024, ...)

材质/灯光验证
look(mode="camera", shading="rendered", max_size=1024, ...)

查看参考图或已有渲染
look(image="/abs/path/ref_front.png", max_size=1024, ...)
```

`look` 不能把图片写入磁盘。需要归档证据时按第 5 节先渲染落盘，再 `look(image=path)` 查看。

---

## 5. QA 证据落盘

`look` 的图片是会话内临时图。Gate 归档必须写入 `.blender-agent/qa/<gate>-<n>/`：

```python
import bpy, os
root = bpy.path.abspath("//")                      # blend 文件所在目录
out = os.path.join(root, ".blender-agent", "qa", "blockout-1")
os.makedirs(out, exist_ok=True)

scene = bpy.context.scene
scene.render.image_settings.file_format = "PNG"
scene.render.resolution_percentage = 100
scene.render.filepath = os.path.join(out, "front.png")
bpy.ops.render.render(write_still=True)
```

多视角归档：相机循环 + 每个角度设置 `scene.camera` 后渲染到不同文件名；
或先用 `look` 快速检查，Gate 通过时再统一渲染归档。

对齐要求：

```text
同一 gate 每轮使用相同相机、相同 resolution_percentage、相同 shading
文件名：front / back / left / right / three_quarter / closeup_face / wireframe
```

---

## 6. Checkpoint

```python
import bpy, os
root = bpy.path.abspath("//")
out = os.path.join(root, ".blender-agent", "checkpoints")
os.makedirs(out, exist_ok=True)
bpy.ops.wm.save_as_mainfile(
    filepath=os.path.join(out, "01_blockout_pass.blend"),
    copy=True                      # 不切换当前文件
)
```

规则：

```text
- 只在 gate pass 后写 checkpoint
- copy=True，避免把用户当前文件切换走
- 文件名严格用 00–09 编号
```

---

## 7. 场景初始化

```python
import bpy, os, json
root = bpy.path.abspath("//")
for d in ("qa", "renders", "checkpoints", "reports"):
    os.makedirs(os.path.join(root, ".blender-agent", d), exist_ok=True)
```

若 blend 尚未保存（`bpy.data.filepath == ""`），先要求用户保存文件，
否则 `.blender-agent` 无处落盘；不要在系统临时目录静默创建。

---

## 8. 安全边界（execute_blender_code）

```text
禁止：
- bpy.ops.wm.quit_blender / 打开其他文件覆盖用户工作
- 删除用户未确认的对象或 collection
- 执行网络请求、安装包、修改外部文件
- 长时间阻塞循环（超过数秒的纯 Python 计算）
- 依赖当前 selection 的 bpy.ops（先显式设置 active/selected）
- 修改全局偏好设置（render 设置按场景修改后可还原）

推荐：
- 直接操作 bpy.data（对象、网格、材质、节点）而不是 bpy.ops
- 需要 bpy.ops 时先保证 context：bpy.context.view_layer.objects.active = obj
- 每步 print 关键结果，便于读取返回值
- 大改前 copy 一份对象：obj.copy() + data.copy()
- render / bake 前检查引擎与色彩管理，结束后还原临时设置
```

---

## 9. 专业操作的落地方式

| Skill 动作 | 落地 |
|---|---|
| 建体块、布尔、倒角、细分 | `execute_blender_code`（bmesh / modifiers） |
| 雕刻（多级精度/remesh/笔刷） | `execute_blender_code` 设置 multires/remesh，笔刷通过 `bpy.ops.sculpt` 或数据 API |
| 重拓扑（吸附/收缩） | `execute_blender_code`（snap / shrinkwrap / bmesh 重建） |
| UV 展开/打包 | `execute_blender_code`（`bpy.ops.uv.*`，显式进入 edit mode） |
| 烘焙 | `execute_blender_code`（节点 bake / `bpy.ops.object.bake`） |
| 材质节点 | `execute_blender_code`（node tree 直接构建） |
| HDRI / PBR 贴图 | `search_assets` + `import_asset`（polyhaven） |
| 打光与相机 | `execute_blender_code`（灯光/相机数据） |
| 预览与 QA | `look` |
| 渲染成片 | `execute_blender_code`（`bpy.ops.render.render`） |
| 导出 | `execute_blender_code`（对应 exporter），再回读验证 |
| 参考/生成资产 | `look(image=...)`；`generate_3d` 仅按用户明确要求使用 |

---

## 10. 资产库的边界

```text
search_assets / import_asset 只能用于：
- HDRI 环境光
- PBR 贴图材质
- 用户明确同意引入的模型资产（道具/环境）

禁止：
- 用导入模型替代本该雕刻/建模的主体
- 不告知用户就使用第三方资产
- 忽略 licence（sketchfab 许可各不相同，polypizza 需 CC-BY 署名）
```

导入模型后必须：

```text
1. 确认 bounding box 与目标尺寸（target_size）
2. 落地到地面（get_scene_info 的 ground 字段）
3. look 验证
4. 在 state / report 里记录来源与许可
```

---

## 11. 失败处理

```text
Blender 未连接 / addon 版本不匹配
→ get_addon_status 读取原因
→ 告知用户启用插件或更新（uvx mcp-for-blender install-addon）
→ 停止生产流程，不猜测场景状态

execute_blender_code 报错
→ 读取 traceback
→ 缩小代码范围重试一次
→ 仍失败则改用直接数据 API，或报告阻塞
→ 禁止原样重复执行同一段失败代码

look 返回空/黑图
→ 检查相机、可见性、渲染引擎、分辨率和 target 是否包含对象
→ 先用 viewport solid 确认场景存在
```

---

## 12. 版本与兼容

```text
本契约按 mcp-for-blender 2.1.x 编写。
工具名或参数变化时，先更新本文件，再改各 Skill。
不要在 Skill 里散落硬编码的工具名；统一引用本文件。
```
