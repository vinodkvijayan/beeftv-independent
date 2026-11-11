package protocol

import (
	"context"
	"testing"
)

// Agnes 图像端点是同步的，文生图与图生图共用 POST /v1/images/generations。
// 官方参数表只承认 model、prompt、size（必填）、ratio、image、return_base64 与
// extra_body：顶层 response_format 是官方明确列出的错误写法，output_format 会被
// 直接拒绝，n 也不在参数表内。因此这里逐字段固定线协议，防止退回 OpenAI 兼容字段。
func TestAgnesImageSendsOnlyDocumentedFields(t *testing.T) {
	adapter := officialPackageAdapter(t, "agnes-image.beeftv-plugin", "agnes-image")
	if adapter.Metadata().RequiresPublicMediaURLs {
		t.Fatal("Agnes images support Data URI reference images and should not mandate public media URLs")
	}
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "agnes-image-2.1-flash", Prompt: "Asian female model in beach photo", AspectRatio: "3:4", Quality: "2k", ImageCount: 4,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/v1/images/generations" {
		t.Fatalf("create = %#v", create)
	}
	// 原生端点在域名根下，originPath 让请求路径替换 Base URL 的路径段，
	// 渠道沿用 .../v1 也能命中正确地址。
	if !create.OriginPath {
		t.Fatal("create must declare originPath")
	}

	body := manifestTestBody(t, create)
	if body["model"] != "agnes-image-2.1-flash" || body["prompt"] != "Asian female model in beach photo" {
		t.Fatalf("body = %#v", body)
	}
	if body["size"] != "2K" {
		t.Fatalf("size = %#v, expect to send 2K according to quality level", body["size"])
	}
	if body["ratio"] != "3:4" {
		t.Fatalf("ratio = %#v, independent ratio field expected", body["ratio"])
	}
	// 官方参数表之外的字段会被上游按“不支持该字段”拒绝，逐个钉死。
	for _, forbidden := range []string{"n", "output_format", "quality", "background", "response_format", "image", "mask", "style", "user"} {
		if _, present := body[forbidden]; present {
			t.Fatalf("body = %#v, the official parameter table does not have the %s field and cannot be sent.", body, forbidden)
		}
	}

	extra, ok := body["extra_body"].(map[string]any)
	if !ok {
		t.Fatalf("extra_body = %#v", body["extra_body"])
	}
	if extra["response_format"] != "url" {
		t.Fatalf("extra_body.response_format = %#v, the output format can only be declared in extra_body", extra["response_format"])
	}
	if _, present := extra["image"]; present {
		t.Fatalf("extra_body = %#v, Vincent pictures should not be sent image", extra)
	}
}

func TestAgnesImagePutsReferencesInExtraBody(t *testing.T) {
	adapter := officialPackageAdapter(t, "agnes-image.beeftv-plugin", "agnes-image")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "agnes-image-2.1-flash", Prompt: "Change outfits and keep original composition", AspectRatio: "3:4", Quality: "1k",
		Images: []MediaReference{
			{URL: "https://cdn.example/anchor.png", Role: "edit_source", Order: 0},
			{DataURL: "data:image/png;base64,QUJD", Role: "edit_source", Order: 1},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	body := manifestTestBody(t, create)
	if _, present := body["image"]; present {
		t.Fatalf("body = %#v, the reference image must be placed in extra_body.image, not the top-level image", body)
	}
	extra, _ := body["extra_body"].(map[string]any)
	images, ok := extra["image"].([]any)
	if !ok || len(images) != 2 {
		t.Fatalf("extra_body.image = %#v, expect two reference images", extra["image"])
	}
	if images[0] != "https://cdn.example/anchor.png" {
		t.Fatalf("The first one = %#v, order determines the order", images[0])
	}
	// 有 Data URL 时优先 Base64：Agnes 明确支持 Data URI，本地开发无法提供公共图片地址。
	if images[1] != "data:image/png;base64,QUJD" {
		t.Fatalf("The second one = %#v, when there is dataUrl, Base64 must be given priority.", images[1])
	}
	if body["size"] != "1K" {
		t.Fatalf("size = %#v, the picture must also carry the required size", body["size"])
	}
}

func TestAgnesImageSizeFollowsPixelOrTier(t *testing.T) {
	adapter := officialPackageAdapter(t, "agnes-image.beeftv-plugin", "agnes-image")
	tests := []struct {
		name        string
		aspectRatio string
		quality     string
		wantSize    string
		wantRatio   string
	}{
		{name: "The ratio falls to the resolution level", aspectRatio: "16:9", quality: "4k", wantSize: "4K", wantRatio: "16:9"},
		{name: "Pixel size is passed through as is", aspectRatio: "1024x768", quality: "2k", wantSize: "1024x768"},
		{name: "auto must also be in gear", aspectRatio: "auto", quality: "1k", wantSize: "1K"},
		{name: "The empty ratio falls back to the default gear.", aspectRatio: "", quality: "", wantSize: "1K"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
				Model: "agnes-image-2.1-flash", Prompt: "circle", AspectRatio: test.aspectRatio, Quality: test.quality,
			}})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, create)
			if body["size"] != test.wantSize {
				t.Fatalf("size = %#v, expect %q", body["size"], test.wantSize)
			}
			gotRatio, present := body["ratio"]
			if test.wantRatio == "" {
				if present {
					t.Fatalf("ratio = %#v, non-ratio input must not be sent ratio", gotRatio)
				}
				return
			}
			if gotRatio != test.wantRatio {
				t.Fatalf("ratio = %#v, expect %q", gotRatio, test.wantRatio)
			}
		})
	}
}

func TestAgnesImageRejectsUnsupportedRatio(t *testing.T) {
	adapter := officialPackageAdapter(t, "agnes-image.beeftv-plugin", "agnes-image")
	// 9:21 / 4:5 等比例不在官方比例表内，静默回落到 1:1 会让用户拿到与选择不符的画幅。
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "agnes-image-2.1-flash", Prompt: "x", AspectRatio: "9:21",
	}}); err == nil {
		t.Fatal("9:21 is not in the official scale and must be rejected during the verification phase")
	}
}

func TestAgnesImageReadsUrlAndBase64Output(t *testing.T) {
	adapter := officialPackageAdapter(t, "agnes-image.beeftv-plugin", "agnes-image")
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"created":1780000000,"data":[{"url":"https://storage.googleapis.com/agnes-aigc/x.png","b64_json":null}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Result == nil || len(result.Result.Images) != 1 || result.Result.Images[0].URL != "https://storage.googleapis.com/agnes-aigc/x.png" {
		t.Fatalf("images = %#v", result.Result)
	}

	inline, err := adapter.ParseCreate(context.Background(), []byte(`{"data":[{"url":null,"b64_json":"aW1hZ2U="}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if inline.Result == nil || len(inline.Result.Images) != 1 || inline.Result.Images[0].DataURL != "data:image/png;base64,aW1hZ2U=" {
		t.Fatalf("images = %#v", inline.Result)
	}
}
