# Voxel Strike

基于 [s-macke/VoxelSpace](https://github.com/s-macke/VoxelSpace) 渲染算法的浏览器直升机空战游戏。纯 JavaScript（ES modules），无依赖、无构建步骤。

## 运行

地图通过 canvas 读取像素，浏览器不允许 `file://` 直接打开，需要起一个本地 HTTP 服务：

```bash
cd voxel-strike
python3 -m http.server 8765
# 打开 http://127.0.0.1:8765/
```

调试参数：`?debug` 每 2 秒在控制台输出状态；`?autoplay` 自动开局并用简易瞄准机器人做冒烟测试。

## 操作

| 操作 | 键盘 / 鼠标 |
| --- | --- |
| 前进 / 后退 | W / S |
| 平移 | A / D |
| 转向 | Q / E、← / →、鼠标（点击画面锁定指针） |
| 上升 / 下降 | Space 或 R / 左 Shift、F、Ctrl |
| 抬头 / 低头 | T / G、鼠标上下 |
| 加速 | B / 右 Shift |
| 机炮 | J、Enter、鼠标左键（连射会过热） |
| 火箭 | K、鼠标右键 |
| 干扰弹 | X（诱偏防空导弹） |
| 暂停 | P / Esc |

触屏设备自动显示双摇杆和开火按钮。

## 玩法

- 逐波消灭坦克、防空导弹阵地（SAM）和敌方直升机，波次越高敌人越多。
- 离地低于 18 时进入"雷达隐蔽"，SAM 不会锁定；飞高视野好但会被导弹追。
- 击毁敌人可能掉落维修包和弹药箱；清波奖励 500×波次 并补给。
- 4 秒内连续击杀叠加连击倍率；最高分保存在 localStorage。
- 30 张原版 Comanche 地图可选，天空色调随地图变化；三档难度、三档画质。

## 渲染改进（相对原版 demo）

- 按屏幕列在相机平面上发射光线，前到后绘制，列被填满即提前退出。
- 远处按步长切换 mipmap，近处双线性采样高度和颜色。
- 距离雾、天空渐变、横滚剪切、俯仰。
- 深度缓冲，体素模型（坦克、SAM、直升机、补给）与地形正确遮挡。
- 渲染分辨率按画质缩放，HUD 在全分辨率 canvas 上单独绘制。

## 文件结构

```
index.html, style.css
js/main.js      游戏状态、波次、菜单、设置
js/renderer.js  Voxel Space 渲染器
js/terrain.js   地图加载、mipmap、高度查询、视线检测
js/player.js    玩家直升机物理与武器
js/enemies.js   坦克 / SAM / 敌机 AI
js/world.js     弹体、粒子、拾取物、碰撞
js/sprites.js   体素模型
js/hud.js       HUD、雷达、目标框
js/input.js     键鼠与触屏输入
js/audio.js     WebAudio 程序化音效
maps/           原版地图（来自 VoxelSpace 仓库）
```

## 版权

代码 MIT。`maps/` 中的地图是从 NovaLogic《Comanche》逆向提取的，不在 VoxelSpace 的 MIT 许可范围内，详见 `LICENSE-VoxelSpace` 与原仓库说明。仅供学习和个人使用。
