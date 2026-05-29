from PIL import Image

# Create icon (1024x1024)
img = Image.new('RGB', (1024, 1024), color='#1a1a1a')
img.save('assets/icon.png')

# Create splash (1242x2436)
img = Image.new('RGB', (1242, 2436), color='#1a1a1a')
img.save('assets/splash-icon.png')

# Create adaptive icon (1024x1024)
img = Image.new('RGB', (1024, 1024), color='#1a1a1a')
img.save('assets/adaptive-icon.png')

print('Images created!')
