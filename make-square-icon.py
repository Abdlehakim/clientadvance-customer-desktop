from PIL import Image

source = "app-icon.png"
output = "app-icon-square.png"

img = Image.open(source).convert("RGBA")

size = max(img.width, img.height)
square = Image.new("RGBA", (size, size), (0, 0, 0, 0))

x = (size - img.width) // 2
y = (size - img.height) // 2

square.paste(img, (x, y), img)
square = square.resize((1024, 1024), Image.LANCZOS)
square.save(output)

print("Created app-icon-square.png")