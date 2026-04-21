/** 粒子效果：上飘湍流 / Particle ash effect */
function createAshEffect(pos) {
    const count = 600;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const vels = [];
    for (let i = 0; i < count; i++) {
        positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z;
        vels.push(new THREE.Vector3((Math.random() - 0.5) * 0.15, Math.random() * 0.15, (Math.random() - 0.5) * 0.15));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ size: 0.05, color: 0xd4af37, transparent: true, blending: THREE.AdditiveBlending });
    const p = new THREE.Points(geo, mat);
    p.userData = { vels, life: 1.0 };
    scene.add(p);
    particles.push(p);
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.userData.life -= 0.015;
        p.material.opacity = p.userData.life;
        const attr = p.geometry.attributes.position;
        for (let j = 0; j < attr.count; j++) {
            attr.array[j * 3] += p.userData.vels[j].x;
            attr.array[j * 3 + 1] += p.userData.vels[j].y + Math.sin(Date.now() * 0.01) * 0.005;
            attr.array[j * 3 + 2] += p.userData.vels[j].z;
        }
        attr.needsUpdate = true;
        if (p.userData.life <= 0) {
            disposeObject(p);
            scene.remove(p);
            particles.splice(i, 1);
        }
    }
}
