// Soft contact shadows under the furniture and along the walls: the static building seen from the floor looking up
// (nearer the floor is darker), blurred twice, on a plane just above the floor. Drawn on demand, when the office
// changes; people are on their own layer, which this camera doesn't see. drei's ContactShadows draws on every
// re-render of its parent and never frees its render targets; this does neither.
import {
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  OrthographicCamera,
  PlaneGeometry,
  type Scene,
  ShaderMaterial,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

const SIZE = 1024;
/** How high above the floor things still cast a contact shadow. */
const REACH = 2.4;
const BLUR = 2.2;

function uniform(material: ShaderMaterial, name: string, value: unknown) {
  const u = material.uniforms[name];
  if (!u) throw new Error(`The blur shader has no ${name}`);
  u.value = value;
}

export class ContactShadows {
  /** The plane that shows the shadows: add it to the scene. */
  readonly mesh: Mesh;
  private readonly target = new WebGLRenderTarget(SIZE, SIZE);
  private readonly blurTarget = new WebGLRenderTarget(SIZE, SIZE);
  private readonly plane: PlaneGeometry;
  private readonly depth = new MeshDepthMaterial();
  private readonly horizontal = new ShaderMaterial(HorizontalBlurShader);
  private readonly vertical = new ShaderMaterial(VerticalBlurShader);
  private readonly quad: Mesh;
  private readonly camera: OrthographicCamera;

  /** Covers `width` by `depth` units centred on (x, z), `y` above the ground. */
  constructor(x: number, y: number, z: number, width: number, depth: number, color = '#2A2925', opacity = 0.5) {
    this.target.texture.generateMipmaps = this.blurTarget.texture.generateMipmaps = false;
    // Facing down, toward a camera that looks up from the floor; the shown plane is flipped to face up.
    this.plane = new PlaneGeometry(width, depth).rotateX(Math.PI / 2);
    this.depth.depthTest = this.depth.depthWrite = false;
    const tint = new Color(color);
    this.depth.onBeforeCompile = (shader) => {
      shader.uniforms.ucolor = { value: tint };
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform vec3 ucolor;\nvoid main() {')
        .replace('vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );');
    };
    this.horizontal.depthTest = this.vertical.depthTest = false;
    this.quad = new Mesh(this.plane, this.horizontal);
    this.camera = new OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 0, REACH);
    this.camera.rotation.set(Math.PI / 2, 0, 0);
    this.camera.position.set(x, y, z);
    this.camera.updateMatrixWorld();
    this.quad.position.set(x, y + 0.5, z);
    this.quad.updateMatrixWorld();
    this.mesh = new Mesh(this.plane, new MeshBasicMaterial({ transparent: true, map: this.target.texture, opacity, depthWrite: false }));
    this.mesh.name = 'contact-shadows';
    this.mesh.position.set(x, y, z);
    this.mesh.scale.set(1, -1, 1);
    this.mesh.renderOrder = 1;
    this.mesh.raycast = () => {};
  }

  /** Draws the shadows of everything the scene shows on the default layer. */
  render(gl: WebGLRenderer, scene: Scene): void {
    const background = scene.background;
    const override = scene.overrideMaterial;
    const previous = gl.getRenderTarget();
    this.mesh.visible = false;
    scene.background = null;
    scene.overrideMaterial = this.depth;
    gl.setRenderTarget(this.target);
    gl.render(scene, this.camera);
    this.blur(gl, BLUR);
    this.blur(gl, BLUR * 0.4);
    gl.setRenderTarget(previous);
    this.mesh.visible = true;
    scene.overrideMaterial = override;
    scene.background = background;
  }

  private blur(gl: WebGLRenderer, amount: number) {
    this.quad.material = this.horizontal;
    uniform(this.horizontal, 'tDiffuse', this.target.texture);
    uniform(this.horizontal, 'h', amount / 256);
    gl.setRenderTarget(this.blurTarget);
    gl.render(this.quad, this.camera);
    this.quad.material = this.vertical;
    uniform(this.vertical, 'tDiffuse', this.blurTarget.texture);
    uniform(this.vertical, 'v', amount / 256);
    gl.setRenderTarget(this.target);
    gl.render(this.quad, this.camera);
  }

  /** Frees the GPU's copies (three makes them again if this is drawn after all, as after a remount). */
  dispose(): void {
    this.target.dispose();
    this.blurTarget.dispose();
    this.plane.dispose();
    this.depth.dispose();
    this.horizontal.dispose();
    this.vertical.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
