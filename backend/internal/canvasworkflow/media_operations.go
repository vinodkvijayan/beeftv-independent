package canvasworkflow

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Media operations have a closed, typed parameter surface: never raw ffmpeg arguments.
func MediaOperations() []Operation {
	crop := []Field{{Key: "x", Label: "left scale", Type: "number"}, {Key: "y", Label: "top proportion", Type: "number"}, {Key: "width", Label: "width ratio", Type: "number"}, {Key: "height", Label: "height ratio", Type: "number"}}
	return []Operation{
		{ID: "image.crop", Version: 1, Name: "Cut", OutputType: "image", Inputs: []InputPort{{"image", "pictures", "image", true, false}}, Fields: crop},
		{ID: "image.resize", Version: 1, Name: "resize", OutputType: "image", Inputs: []InputPort{{"image", "pictures", "image", true, false}}, Fields: []Field{{Key: "longEdge", Label: "long side pixels", Type: "number"}, {Key: "algorithm", Label: "interpolation algorithm", Type: "select", Options: []FieldOption{{Label: "high quality", Value: "high"}, {Label: "Bilinear", Value: "bilinear"}, {Label: "nearest neighbor", Value: "nearest"}}}}},
		{ID: "video.crop", Version: 1, Name: "Screen cropping", OutputType: "video", Inputs: []InputPort{{"video", "video", "video", true, false}}, Fields: crop},
		{ID: "video.frame", Version: 1, Name: "Key frame interception", OutputType: "image", Inputs: []InputPort{{"video", "video", "video", true, false}}, Fields: []Field{{Key: "seconds", Label: "Frame capture seconds", Type: "number"}}},
		{ID: "video.audio", Version: 1, Name: "Audio and video separation", OutputType: "audio", Inputs: []InputPort{{"video", "video", "video", true, false}}, Fields: []Field{}},
	}
}

func IsMediaOperation(id string) bool {
	for _, op := range MediaOperations() {
		if op.ID == id {
			return true
		}
	}
	return false
}

func ValidateMediaConfig(n Node) error {
	switch n.OperationID {
	case "image.crop", "video.crop":
		x, y, w, h := operationNumber(n.Config["x"]), operationNumber(n.Config["y"]), operationNumber(n.Config["width"]), operationNumber(n.Config["height"])
		if x < 0 || y < 0 || w <= 0 || h <= 0 || x+w > 1.000001 || y+h > 1.000001 {
			return fmt.Errorf("Crop area must be within aspect ratio 0 to 1")
		}
	case "image.resize":
		value := operationNumber(n.Config["longEdge"])
		if value < 16 || value > 4096 || math.Trunc(value) != value {
			return fmt.Errorf("The long side of the image needs to be an integer from 16 to 4096")
		}
		if value, ok := n.Config["algorithm"]; ok && value != "high" && value != "bilinear" && value != "nearest" {
			return fmt.Errorf("Unsupported image interpolation algorithm")
		}
	case "video.frame":
		value := operationNumber(n.Config["seconds"])
		if value < 0 || value > 43200 {
			return fmt.Errorf("The frame time is invalid")
		}
	}
	return nil
}

func MediaCommand(n Node, width, height int) (args []string, extension, mime string, err error) {
	if !IsMediaOperation(n.OperationID) {
		return nil, "", "", fmt.Errorf("Unsupported media handling")
	}
	if err = ValidateOperation(n); err != nil {
		return
	}
	extension, mime = ".png", "image/png"
	switch n.OperationID {
	case "image.crop", "video.crop":
		if width <= 0 || height <= 0 {
			err = fmt.Errorf("The material is missing a valid size")
			return
		}
		x, y := int(operationNumber(n.Config["x"])*float64(width)), int(operationNumber(n.Config["y"])*float64(height))
		w, h := int(operationNumber(n.Config["width"])*float64(width)), int(operationNumber(n.Config["height"])*float64(height))
		if n.OperationID == "image.crop" {
			w = int(math.Ceil(operationNumber(n.Config["width"]) * float64(width)))
			h = int(math.Ceil(operationNumber(n.Config["height"]) * float64(height)))
		}
		if n.OperationID == "video.crop" {
			w = w / 2 * 2
			h = h / 2 * 2
			x = x / 2 * 2
			y = y / 2 * 2
			extension, mime = ".mp4", "video/mp4"
		}
		if w < 1 || h < 1 {
			err = fmt.Errorf("Cropping area is too small")
			return
		}
		args = []string{"-vf", fmt.Sprintf("crop=%d:%d:%d:%d", w, h, x, y)}
	case "image.resize":
		if width <= 0 || height <= 0 {
			err = fmt.Errorf("The material is missing a valid size")
			return
		}
		edge := int(operationNumber(n.Config["longEdge"]))
		w, h := edge, max(1, int(math.Round(float64(height)*float64(edge)/float64(width))))
		if height > width {
			h = edge
			w = max(1, int(math.Round(float64(width)*float64(edge)/float64(height))))
		}
		algorithm := "bicubic"
		if n.Config["algorithm"] == "bilinear" {
			algorithm = "bilinear"
		}
		if n.Config["algorithm"] == "nearest" {
			algorithm = "neighbor"
		}
		filters := []string{}
		if algorithm == "bicubic" {
			for sw, sh := width, height; sw*2 < w && sh*2 < h; {
				sw, sh = sw*2, sh*2
				filters = append(filters, fmt.Sprintf("scale=%d:%d:flags=bicubic", sw, sh))
			}
		}
		filters = append(filters, fmt.Sprintf("scale=%d:%d:flags=%s", w, h, algorithm))
		args = []string{"-vf", strings.Join(filters, ",")}
	case "video.frame":
		args = []string{"-ss", strconv.FormatFloat(operationNumber(n.Config["seconds"]), 'f', 3, 64)}
	case "video.audio":
		return []string{"-vn", "-c:a", "aac"}, ".m4a", "audio/mp4", nil
	}
	if n.MediaType == "image" {
		args = append(args, "-frames:v", "1", "-an")
	} else {
		args = append(args, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart")
	}
	return
}
