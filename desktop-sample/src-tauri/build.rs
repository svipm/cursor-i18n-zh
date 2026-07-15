use std::{fs, path::Path};

fn write_u16(bytes: &mut Vec<u8>, value: u16) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn write_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn ensure_sample_icon() {
    let icon_path = Path::new("icons/icon.ico");
    if icon_path.exists() {
        return;
    }

    const SIZE: u32 = 32;
    let pixel_bytes = SIZE * SIZE * 4;
    let mask_row_bytes = SIZE.div_ceil(32) * 4;
    let mask_bytes = mask_row_bytes * SIZE;
    let image_bytes = 40 + pixel_bytes + mask_bytes;
    let mut icon = Vec::with_capacity((22 + image_bytes) as usize);

    write_u16(&mut icon, 0);
    write_u16(&mut icon, 1);
    write_u16(&mut icon, 1);
    icon.push(SIZE as u8);
    icon.push(SIZE as u8);
    icon.push(0);
    icon.push(0);
    write_u16(&mut icon, 1);
    write_u16(&mut icon, 32);
    write_u32(&mut icon, image_bytes);
    write_u32(&mut icon, 22);

    write_u32(&mut icon, 40);
    write_u32(&mut icon, SIZE);
    write_u32(&mut icon, SIZE * 2);
    write_u16(&mut icon, 1);
    write_u16(&mut icon, 32);
    write_u32(&mut icon, 0);
    write_u32(&mut icon, pixel_bytes);
    write_u32(&mut icon, 0);
    write_u32(&mut icon, 0);
    write_u32(&mut icon, 0);
    write_u32(&mut icon, 0);

    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - 15.5;
            let dy = y as f32 - 15.5;
            let inside = dx * dx + dy * dy < 215.0;
            let (blue, green, red, alpha) = if inside {
                let blend = (x + (SIZE - y)) as f32 / (SIZE * 2) as f32;
                (
                    (210.0 + blend * 30.0) as u8,
                    (70.0 + blend * 35.0) as u8,
                    (112.0 + blend * 45.0) as u8,
                    255,
                )
            } else {
                (0, 0, 0, 0)
            };
            icon.extend_from_slice(&[blue, green, red, alpha]);
        }
    }
    icon.resize((22 + image_bytes) as usize, 0);

    fs::create_dir_all("icons").expect("failed to create icon directory");
    fs::write(icon_path, icon).expect("failed to write sample icon");
}

fn main() {
    ensure_sample_icon();
    tauri_build::build()
}
