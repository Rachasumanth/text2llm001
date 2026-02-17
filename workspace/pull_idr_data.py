import ezomero
import os
from PIL import Image
import numpy as np

# IDR Public Server Config
HOST = "idr.openmicroscopy.org"
PORT = 4064
USER = "public"
PASS = "public"

def download_idr_data(dataset_id, limit=10):
    print(f"Connecting to {HOST}...")
    try:
        with ezomero.connect(USER, PASS, HOST, PORT, secure=True) as conn:
            print(f"Fetching images for Dataset:{dataset_id}...")
            image_ids = ezomero.get_image_ids(conn, dataset_id=dataset_id)
            
            if not image_ids:
                print("No images found.")
                return

            os.makedirs("microscope_data", exist_ok=True)
            
            for i, img_id in enumerate(image_ids[:limit]):
                print(f"Downloading image {img_id} ({i+1}/{limit})...")
                # Get pixels as numpy array (usually 5D: T, C, Z, Y, X)
                pixels, _ = ezomero.get_pixels(conn, img_id)
                
                # Take middle Z-slice, first channel, first timepoint for preview/simple training
                # Shape is usually (T, C, Z, Y, X)
                mid_z = pixels.shape[2] // 2
                slice_2d = pixels[0, 0, mid_z, :, :]
                
                # Normalize and save as JPG
                slice_norm = ((slice_2d - slice_2d.min()) / (slice_2d.max() - slice_2d.min()) * 255).astype(np.uint8)
                img = Image.fromarray(slice_norm)
                img.save(f"microscope_data/img_{img_id}.jpg")
                
            print(f"Downloaded {min(len(image_ids), limit)} images to 'microscope_data/'.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    # idr0013 Dataset ID is 101 (one of the datasets in the project)
    download_idr_data(dataset_id=101, limit=5)
