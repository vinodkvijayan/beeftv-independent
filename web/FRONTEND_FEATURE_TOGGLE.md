# Instructions for modifying the front-end function switch maintenance page

## Modify content

### 1. Type definition update

**File**: `web/src/stores/use-user-store.ts`

Added `frontendModelsEnabled` field to `FeatureAvailability` type:

```typescript
export type FeatureAvailability = {
    shortDramaEnabled: boolean;
    taskCenterEnabled: boolean;
    creditsEnabled: boolean;
    customChannelsEnabled: boolean;
    frontendModelsEnabled: boolean;  // 新增
    desktopLocalChannelsEnabled: boolean;
    configured?: boolean;
    updatedBy?: string;
    updatedAt?: string;
};
```

The default value is set to `true`:

```typescript
export const defaultFeatureAvailability: FeatureAvailability = {
    shortDramaEnabled: true,
    taskCenterEnabled: true,
    creditsEnabled: true,
    customChannelsEnabled: true,
    frontendModelsEnabled: true,  // 新增
    desktopLocalChannelsEnabled: false,
};
```

### 2. Management interface update

**File**: `web/src/pages/admin/components/feature-availability-panel.tsx`

#### Add icon import```typescript
import { Sparkles } from "lucide-react";
```

#### Extend FeatureKey type```typescript
type FeatureKey = "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled" | "customChannelsEnabled" | "frontendModelsEnabled";
```

#### Add function configuration items
New configuration items were added to the `featureRows` array:

```typescript
{
    key: "frontendModelsEnabled",
    title: "前台模型目录",
    menu: "/admin/models",
    description: "开启时使用前台模型虚拟渠道（需配置路由），关闭时使用脱敏的系统渠道模型。管理员的模型配置入口始终保留。",
    icon: <Sparkles className="size-4" />
}
```

#### Update save function
Added support for new fields in `save` function:

```typescript
const result = await updateAdminFeatureAvailability({
    shortDramaEnabled: next.shortDramaEnabled,
    taskCenterEnabled: next.taskCenterEnabled,
    creditsEnabled: next.creditsEnabled,
    customChannelsEnabled: next.customChannelsEnabled,
    frontendModelsEnabled: next.frontendModelsEnabled,  // 新增
});
```

#### Add switching confirmation logic
Added a secondary confirmation when closing the foreground model in the `toggle` function:

```typescript
// 前台模型关闭需要二次确认
if (key === "frontendModelsEnabled" && !enabled) {
    modal.confirm({
        title: "切换到系统渠道模型？",
        content: "关闭后，用户将使用脱敏的系统渠道模型目录，任务创建时将禁止 logicalModelId。管理员的前台模型配置入口保持可见。",
        okText: "确认切换",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => save(key, false),
    });
    return;
}
```

## User interface effects

### Function switch panel

In the "Function Opening" page (`/admin/features`), a new switch item will be displayed:

- **Icon**: ✨ (Sparkles)
- **Title**: Front-end model directory
- **Menu path**: /admin/models
- **Description**: Use the front-end model virtual channel when it is turned on (routing needs to be configured), and use the desensitized system channel model when it is turned off. The administrator's model configuration entry is always retained.
- **Default state**: On (true)

### Interaction process

1. **Open the front-end model**
   - Click the switch to turn it on
   - The user side will use the front-end model virtual channel
   - Task creation must provide `logicalModelId`

2. **Close the front model**
   - Clicking the switch will pop up a confirmation dialog box
   - After confirmation, switch to system channel model mode
   - The user side will use the desensitized system channel model directory
   - Task creation prohibited `logicalModelId`

3. **Administrator Rights**
   - Regardless of the switch status, the administrator's `/admin/models` entry is always retained
   - Administrators can view and configure the front-end model at any time

## Visual design

```
┌─────────────────────────────────────────────────────────────────┐
│ 用户功能开放                                      5/5 已开放    │
├─────────────────────────────────────────────────────────────────┤
│ 🎬 短剧创作                          /projects            [ON]  │
│    关闭后隐藏短剧入口...                                        │
├─────────────────────────────────────────────────────────────────┤
│ ☑️  任务                            /tasks                [ON]  │
│    关闭后仅隐藏并拦截任务中心页面...                            │
├─────────────────────────────────────────────────────────────────┤
│ 💰 积分中心                          弹窗                 [ON]  │
│    关闭后隐藏用户积分入口...                                    │
├─────────────────────────────────────────────────────────────────┤
│ 📡 自定义渠道                        /settings?section... [ON]  │
│    关闭后隐藏用户自定义渠道入口...                              │
├─────────────────────────────────────────────────────────────────┤
│ ✨ 前台模型目录                      /admin/models        [ON]  │
│    开启时使用前台模型虚拟渠道（需配置路由），                  │
│    关闭时使用脱敏的系统渠道模型...                              │
└─────────────────────────────────────────────────────────────────┘
```

## Backend API adaptation

The backend API already supports the `frontendModelsEnabled` field:

- `GET /api/admin/feature-availability` - Read configuration (contains new fields)
- `PUT /api/admin/feature-availability` - Update configuration (accepts new fields)

## Testing suggestions

1. **Switch switching test**
   - Test on/off foreground model switch
   - Verify whether the secondary confirmation dialog box is displayed normally
   - Verify that status is updated correctly after saving

2. **Permission Test**
   - Verify that only administrators can access this page
   - Verify that non-administrators cannot modify this configuration

3. **Linkage Test**
   - After turning on the front-end model, verify whether the user-side model selector uses the front-end model
   - After closing the front-end model, verify that the user-side model selector uses the system channel model
   - Verify that the administrator's `/admin/models` entry is accessible in both modes

4. **Data persistence test**
   - Refresh the page after modifying the configuration to verify whether the configuration is saved.
   - Verify that the configuration loads correctly when the user logs in

## Notes

1. **Backend synchronization**: Front-end modifications rely on back-end API support, ensure that the back-end has deployed relevant updates
2. **Cache Cleaning**: After modification, it is recommended to clear the browser cache to ensure that the type update takes effect.
3. **User Impact**: Switching model mode will affect the model selection interface of all users. It is recommended to operate during off-peak hours.
4. **Rollback solution**: If you encounter problems, you can quickly switch back to the original mode through the management interface

## File list

### Modified files
- `web/src/stores/use-user-store.ts` - Add type definition and default value
- `web/src/pages/admin/components/feature-availability-panel.tsx` - Add UI and interaction logic

### Dependent backend files
- `internal/service/feature_availability.go` - Backend function switch service

---

**Modification date**: 2026-08-22
**Scope of Impact**: Administrator function switch page
**User Impact**: None, only visible to administrators